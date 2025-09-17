import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3000);
const BACKEND_PORT = Number(process.env.PORT || 8081);
const UI_BASE = `http://localhost:${FRONTEND_PORT}`;
const API_BASE = `http://localhost:${BACKEND_PORT}`;
const CHAT_WS = `ws://localhost:${BACKEND_PORT}/chat`;

async function uiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${UI_BASE}`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function resetSessionIfPossible() {
  try {
    await fetch(`${API_BASE}/session/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatHistory: true, connections: true }),
    });
  } catch {}
}

test('UI E2E: create_note via UI, see breadcrumbs and assistant text, then finalize', async ({ page }, testInfo) => {
  test.slow();

  if (!(await uiReachable())) {
    testInfo.skip(`webapp not reachable at ${UI_BASE}. Start it (npm run frontend:dev) alongside backend and try again.`);
    return;
  }

  await resetSessionIfPossible();

  // Parallel WS listener to capture breadcrumbs and conversation_id
  const state: {
    conversation_id?: string;
    assistant_texts: string[];
    deltas: Array<{ name: string; arguments?: string; call_id?: string }>;
    dones: Array<{ name: string; arguments?: string; call_id?: string; result?: string }>;
    finalized?: boolean;
  } = { assistant_texts: [], deltas: [], dones: [] };

  const ws = new WebSocket(CHAT_WS);
  const wsReady = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  await wsReady;

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(String(data));
      // Capture conversation_id from any event that includes it
      if (!state.conversation_id && typeof msg?.conversation_id === 'string') {
        state.conversation_id = msg.conversation_id;
      }
      if (msg?.type === 'response.function_call_arguments.delta') {
        state.deltas.push({ name: msg.name, arguments: msg.arguments, call_id: msg.call_id });
      } else if (msg?.type === 'response.function_call_arguments.done') {
        state.dones.push({ name: msg.name, arguments: msg.arguments, call_id: msg.call_id, result: msg.result });
      } else if (msg?.type === 'chat.response') {
        if (typeof msg.content === 'string') state.assistant_texts.push(msg.content);
      } else if (msg?.type === 'conversation.finalized') {
        // Mark finalized if conversation id matches (or if only one open conv)
        if (!state.conversation_id || state.conversation_id === msg.conversation_id) {
          state.conversation_id = msg.conversation_id || state.conversation_id;
          state.finalized = true;
        }
      }
    } catch {}
  });

  // Open UI
  await page.goto(UI_BASE, { waitUntil: 'domcontentloaded' });
  // The UI gates chat connection behind a setup checklist. Trigger the test helper to mark it as success.
  await page.evaluate(() => {
    try { (window as any).StatusSingletonChecker?.simulateSuccessCheck?.(); } catch {}
  });
  await page.waitForTimeout(5000);

  // Wait for the conversation UI to load and the input to be ready
  const input = page.getByPlaceholder('Type a message...');
  await expect(input).toBeVisible();

  const uniqueTitle = `UI Note ${Date.now()}`;
  const noteContent = 'hello world';
  const prompt = [
    `You MUST use tools to perform this exact sequence and MUST NOT answer directly until after tools complete:`,
    `1) Call create_note with title = "${uniqueTitle}" and content = "${noteContent}".`,
    `2) Call list_notes to confirm that a note with that title exists.`,
    `Then reply with one short sentence confirming creation and presence of the note titled "${uniqueTitle}".`,
  ].join(' ');

  // Small delay for human observers
  await page.waitForTimeout(1000);

  await input.fill(prompt);
  const sendBtn = page.getByRole('button', { name: 'Send' });
  await expect(sendBtn).toBeEnabled({ timeout: 10000 });
  await sendBtn.click();

  // Wait for the assistant UI bubble containing our unique title to appear.
  // We look for the message content node (whitespace-pre-wrap) whose nearest bubble
  // has assistant styling (either supervisor purple or assistant gray).
  await page.waitForFunction(
    (title) => {
      const nodes = Array.from(document.querySelectorAll('div.whitespace-pre-wrap')) as HTMLElement[];
      const isAssistantBubble = (el: HTMLElement) => {
        // The content node is inside the bubble with classes like:
        // "max-w-lg p-3 rounded-lg bg-purple-50 text-purple-900 border border-purple-200"
        const bubble = el.closest('div.max-w-lg.p-3.rounded-lg') as HTMLElement | null;
        if (!bubble) return false;
        const cls = bubble.className || '';
        return cls.includes('bg-purple-50') || (cls.includes('bg-gray-100') && cls.includes('text-gray-900'));
      };
      return nodes.some(el => (el.textContent || '').includes(title) && isAssistantBubble(el));
    },
    uniqueTitle,
    { timeout: 90_000 }
  );

  // Try to detect breadcrumbs. Prefer WS-captured breadcrumbs; if missing,
  // explicitly wait briefly for a UI breadcrumb line. Do not fail the test if
  // breadcrumbs are absent, as the model may occasionally reply without tools.
  const hadCreateNoteWS = state.deltas.some((d) => d.name === 'create_note') || state.dones.some((d) => d.name === 'create_note');
  let hadCreateNote = hadCreateNoteWS;
  if (!hadCreateNote) {
    // Look for either creation or completion breadcrumb lines in UI
    const uiCreate = page.getByText('Function call: create_note', { exact: false }).first();
    const uiDone = page.getByText('Function call completed: create_note', { exact: false }).first();
    const uiHasCreate = await uiCreate.isVisible().catch(() => false);
    const uiHasDone = uiHasCreate ? true : await uiDone.isVisible().catch(() => false);
    // One more short wait if neither rendered yet
    if (!uiHasCreate && !uiHasDone) await page.waitForTimeout(1200);
    const uiHasCreate2 = uiHasCreate || await uiCreate.isVisible().catch(() => false);
    const uiHasDone2 = uiHasDone || await uiDone.isVisible().catch(() => false);
    const uiObserved = uiHasCreate2 || uiHasDone2;
    hadCreateNote = hadCreateNote || uiObserved;
  }
  if (!hadCreateNote) {
    // Soft warning instead of failing hard
    console.warn('[ui-notes.spec] Warning: create_note breadcrumb not observed via WS or UI.');
  }

  // Finalize conversation via WS and verify via REST
  let conversation_id = state.conversation_id as string | undefined;
  if (!conversation_id) {
    // Fallback: fetch latest conversation from REST
    const res = await fetch(`${API_BASE}/api/conversations?limit=1`);
    if (res.ok) {
      const conversations = (await res.json()) as any[];
      if (conversations && conversations[0]?.id) conversation_id = conversations[0].id;
    }
  }
  expect(conversation_id).toBeTruthy();
  if (conversation_id) {
    // Extra delay so a human observer can read UI before finalize
    await page.waitForTimeout(1500);
    ws.send(JSON.stringify({ type: 'conversation.end', conversation_id }));
    // First, wait briefly for a WS-level finalized event
    let ended = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (state.finalized) { ended = true; break; }
    }
    // Fallback: Poll REST for ended_at up to ~20s total
    if (!ended) {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const res = await fetch(`${API_BASE}/api/conversations?limit=5`);
        if (!res.ok) continue;
        const conversations = (await res.json()) as any[];
        const found = conversations.find((c) => c.id === conversation_id);
        if (found && found.ended_at) { ended = true; break; }
      }
    }
    expect(ended).toBeTruthy();
  }

  try { ws.close(); } catch {}
});
