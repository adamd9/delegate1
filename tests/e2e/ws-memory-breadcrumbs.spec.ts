/**
 * Verifies that memory breadcrumbs (🧠 / 💾) persist into the history section
 * after a conversation is ended.
 *
 * Flow:
 *  1. Open UI, send a message (triggers memory.retrieved / memory.pending)
 *  2. End the conversation
 *  3. Reload the page
 *  4. Expand the history section
 *  5. Assert ≥1 memory breadcrumb (🧠) exists inside the history block
 *  6. Assert NO memory breadcrumb leaked into the live / current section
 */

import { test, expect } from '@playwright/test';

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 8081);
const BACKEND_PORT  = Number(process.env.PORT        || 8081);
const UI_BASE  = `http://localhost:${FRONTEND_PORT}`;
const API_BASE = `http://localhost:${BACKEND_PORT}`;

async function uiReachable(): Promise<boolean> {
  try { return (await fetch(UI_BASE)).ok; } catch { return false; }
}

async function resetSession() {
  try {
    await fetch(`${API_BASE}/session/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatHistory: true, connections: true }),
    });
  } catch {}
}

test('memory breadcrumbs appear in history section after reload', async ({ page }, testInfo) => {
  test.slow();

  if (!(await uiReachable())) {
    testInfo.skip(`webapp not reachable at ${UI_BASE}`);
    return;
  }

  await resetSession();

  // ── Phase 1: send a message ──────────────────────────────────────────────
  await page.goto(UI_BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try { (window as any).StatusSingletonChecker?.simulateSuccessCheck?.(); } catch {}
  });
  await page.waitForTimeout(5000);

  const input = page.locator('#int-input');
  await expect(input).toBeVisible({ timeout: 15_000 });

  // Send a plain conversational message — enough to trigger the memory retrieval path
  await input.fill('Hey, what is the capital of Australia?');
  const sendBtn = page.locator('#int-send');
  await expect(sendBtn).toBeEnabled({ timeout: 10_000 });
  await sendBtn.click();

  // Wait for assistant reply bubble in UI (up to 60s)
  await page.waitForFunction(
    () => document.querySelectorAll('div.ev-group.left').length > 0,
    { timeout: 60_000 }
  );

  // Wait a moment for any trailing memory WS events to arrive and persist
  await page.waitForTimeout(2000);

  // ── Phase 2: end the conversation via the UI button ──────────────────────
  // Get the current open conversation from REST (avoids accessing non-global window.state)
  let conversationId: string | undefined;
  try {
    const res = await fetch(`${API_BASE}/api/conversations?limit=10`);
    if (res.ok) {
      const convs = (await res.json()) as any[];
      // Find the most recently started open conversation
      const open = convs.filter((c: any) => !c.ended_at).sort((a: any, b: any) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      )[0];
      if (open?.id) conversationId = open.id;
    }
  } catch {}
  expect(conversationId, 'should find an open conversation before ending').toBeTruthy();

  // Click the "end conversation" button on the page
  // The button shows a confirm() dialog — accept it automatically
  page.once('dialog', dialog => dialog.accept());
  const endBtn = page.locator('#btn-end');
  await expect(endBtn).toBeVisible({ timeout: 5_000 });
  await endBtn.click();

  // Poll until the conversation has ended_at set
  let conversationEnded = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(`${API_BASE}/api/conversations?limit=10`);
      if (res.ok) {
        const convs = (await res.json()) as any[];
        const found = convs.find((c: any) => c.id === conversationId);
        if (found?.ended_at) { conversationEnded = true; break; }
      }
    } catch {}
  }
  expect(conversationEnded, 'conversation should have ended_at after clicking end button').toBeTruthy();

  // Give async extraction a moment to write memory_stored to SQLite
  await page.waitForTimeout(3000);

  // ── Phase 3: reload ───────────────────────────────────────────────────────
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try { (window as any).StatusSingletonChecker?.simulateSuccessCheck?.(); } catch {}
  });
  // Wait for history replay events to arrive and be processed
  await page.waitForTimeout(5000);

  // ── Phase 4: verify breadcrumbs are hidden until history is expanded ─────
  // The history accordion must exist (server replayed an ended conversation)
  const histBlock = page.locator('#hist-block');
  await expect(histBlock).toBeVisible({ timeout: 10_000 });

  // With the fix: memory breadcrumbs carry replay:true → isHidden:true → NOT in DOM yet
  const eventsEl  = page.locator('#events');
  const memoryBeforeExpand = eventsEl.locator(':scope >> text=/🧠/');
  await expect(memoryBeforeExpand).toHaveCount(0, { timeout: 3_000 });

  // ── Phase 5: expand history and verify breadcrumbs appear ────────────────
  await page.locator('#hist-toggle').click();
  await page.waitForTimeout(500);

  // After expanding, history breadcrumbs are rendered into #events
  const memoryAfterExpand = eventsEl.locator(':scope >> text=/🧠/');
  const countAfterExpand = await memoryAfterExpand.count();
  expect(countAfterExpand, `Expected ≥1 🧠 breadcrumb in #events after expanding history, got ${countAfterExpand}`).toBeGreaterThan(0);
});
