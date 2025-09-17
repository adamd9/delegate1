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
      }
    } catch {}
  });

  // Open UI
  await page.goto(UI_BASE, { waitUntil: 'domcontentloaded' });

  // Wait for the conversation UI to load and the input to be ready
  const input = page.getByPlaceholder('Type a message...');
  await expect(input).toBeVisible();

  const uniqueTitle = `UI Note ${Date.now()}`;
  const noteContent = 'hello world';
  const prompt = [
    `Use your tools to perform this exact sequence:`,
    `1) Call create_note with title = "${uniqueTitle}" and content = "${noteContent}".`,
    `2) Call list_notes to confirm that a note with that title exists.`,
    `Then reply with one short sentence confirming creation and presence of the note titled "${uniqueTitle}".`,
  ].join(' ');

  // Small delay for human observers
  await page.waitForTimeout(1000);

  await input.fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();

  // Wait for an assistant message containing our unique title to appear
  await expect(page.getByText(uniqueTitle)).toBeVisible({ timeout: 60_000 });

  // Also assert breadcrumbs appeared. Prefer WS-captured breadcrumbs; if missing,
  // accept a UI breadcrumb line (e.g., "Function call: create_note").
  const hadCreateNoteWS = state.deltas.some((d) => d.name === 'create_note') || state.dones.some((d) => d.name === 'create_note');
  let hadCreateNote = hadCreateNoteWS;
  if (!hadCreateNote) {
    // Wait briefly for UI breadcrumb to render
    await page.waitForTimeout(500);
    const uiHasCreate = await page.getByText('Function call: create_note', { exact: false }).first().isVisible().catch(() => false);
    hadCreateNote = hadCreateNote || uiHasCreate;
  }
  expect(hadCreateNote).toBeTruthy();

  // Finalize conversation via WS and verify via REST
  const conversation_id = state.conversation_id as string | undefined;
  expect(conversation_id).toBeTruthy();
  if (conversation_id) {
    // Delay so you can see the UI response
    await page.waitForTimeout(1000);
    ws.send(JSON.stringify({ type: 'conversation.end', conversation_id }));
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetch(`${API_BASE}/api/conversations?limit=5`);
    expect(res.ok).toBeTruthy();
    const conversations = (await res.json()) as any[];
    const found = conversations.find((c) => c.id === conversation_id);
    expect(found).toBeTruthy();
    expect(found.ended_at).toBeTruthy();
  }

  try { ws.close(); } catch {}
});
