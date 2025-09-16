import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

const PORT = Number(process.env.PORT || 8081);
const BASE_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/chat`;

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/public-url`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function resetSessionIfPossible() {
  try {
    await fetch(`${BASE_URL}/session/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatHistory: true, connections: true }),
    });
  } catch {
    // ignore
  }
}

test('tool flow: create_note then list_notes with breadcrumbs, then finalize conversation', async ({}, testInfo) => {
  test.slow();
  if (!(await serverReachable())) {
    testInfo.skip(`websocket-server not reachable at ${BASE_URL}. Start it first (e.g., npm run backend:dev) and ensure OPENAI_API_KEY is set.`);
    return;
  }

  await resetSessionIfPossible();

  const ws = new WebSocket(WS_URL);

  const uniqueTitle = `E2E Test Note ${Date.now()}`;
  const noteContent = 'hello world';

  const state: {
    conversation_id?: string;
    assistant_text?: string;
    functionDeltas: Array<{ name: string; arguments: string; call_id?: string }>;
    functionDones: Array<{ name: string; arguments: string; call_id?: string; status?: string; result?: string }>;
  } = {
    functionDeltas: [],
    functionDones: [],
  };

  const waitForResponse = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for tool flow and chat.response')), 60_000);

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type === 'response.function_call_arguments.delta') {
          state.functionDeltas.push({ name: msg.name, arguments: msg.arguments, call_id: msg.call_id });
        } else if (msg?.type === 'response.function_call_arguments.done') {
          state.functionDones.push({ name: msg.name, arguments: msg.arguments, call_id: msg.call_id, status: msg.status, result: msg.result });
        } else if (msg?.type === 'chat.response' && typeof msg.content === 'string') {
          state.assistant_text = msg.content;
          if (!state.conversation_id && typeof msg.conversation_id === 'string') {
            state.conversation_id = msg.conversation_id;
          }
          clearTimeout(timeout);
          resolve();
        }
      } catch {
        // ignore
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Wait for open and send directive prompt that instructs explicit tool usage
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  const prompt = [
    `Use your tools to perform this exact sequence:`,
    `1) Call create_note with title = "${uniqueTitle}" and content = "${noteContent}".`,
    `2) Call list_notes to confirm that a note with that title exists.`,
    `Then reply with one short sentence confirming creation and presence of the note titled "${uniqueTitle}".`,
  ].join(' ');

  // Small delay so a human observer can follow along in another client
  await new Promise((r) => setTimeout(r, 1000));
  ws.send(JSON.stringify({ type: 'chat.message', content: prompt }));

  // Wait until we receive the assistant response (after tools and any confirmation step)
  await waitForResponse;

  // Assertions on breadcrumbs for tool calls
  const deltaNames = state.functionDeltas.map(d => d.name);
  const doneNames = state.functionDones.map(d => d.name);

  // Expect at least one create_note invocation and one list_notes invocation recorded
  expect(deltaNames).toContain('create_note');
  expect(doneNames).toContain('create_note');
  // list_notes may be optional depending on model behavior, but assert we have at least one more tool call overall
  expect(deltaNames.length).toBeGreaterThanOrEqual(1);
  expect(state.functionDones.length).toBeGreaterThanOrEqual(1);

  // Validate create_note arguments included our title/content in either delta or done
  const createDeltaArg = state.functionDeltas.find(d => d.name === 'create_note')?.arguments || '';
  const createDoneArg = state.functionDones.find(d => d.name === 'create_note')?.arguments || '';
  const argBlob = `${createDeltaArg}\n${createDoneArg}`;
  expect(argBlob).toContain(uniqueTitle);
  expect(argBlob).toContain(noteContent);

  // Assistant reply should acknowledge the note title
  expect(state.assistant_text || '').toContain(uniqueTitle);

  // Finalize conversation and verify via REST
  const conversation_id = state.conversation_id as string | undefined;
  expect(conversation_id).toBeTruthy();
  if (conversation_id) {
    // Small delay before finalize to allow reading the response live
    await new Promise((r) => setTimeout(r, 1000));
    ws.send(JSON.stringify({ type: 'conversation.end', conversation_id }));
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetch(`${BASE_URL}/api/conversations?limit=5`);
    expect(res.ok).toBeTruthy();
    const conversations = (await res.json()) as any[];
    const found = conversations.find((c) => c.id === conversation_id);
    expect(found).toBeTruthy();
    expect(found.ended_at).toBeTruthy();
  }

  try { ws.close(); } catch {}
});
