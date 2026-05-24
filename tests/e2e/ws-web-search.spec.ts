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

test('web_search tool fires and answer reflects search result', async ({}, testInfo) => {
  test.slow();
  if (!(await serverReachable())) {
    testInfo.skip(`websocket-server not reachable at ${BASE_URL}. Start it first (e.g., npm run dev) and ensure OPENAI_API_KEY is set.`);
    return;
  }

  await resetSessionIfPossible();

  const ws = new WebSocket(WS_URL);

  const state: {
    conversation_id?: string;
    assistant_text?: string;
    deltas: Array<{ name: string; arguments: string; call_id?: string }>;
    dones: Array<{ name: string; arguments: string; call_id?: string; status?: string; result?: string }>;
  } = { deltas: [], dones: [] };

  const waitForResponse = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for web_search response')), 75_000);

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type === 'response.function_call_arguments.delta') {
          state.deltas.push({ name: msg.name, arguments: msg.arguments, call_id: msg.call_id });
        } else if (msg?.type === 'response.function_call_arguments.done') {
          state.dones.push({ name: msg.name, arguments: msg.arguments, call_id: msg.call_id, status: msg.status, result: msg.result });
        } else if (msg?.type === 'chat.response' && typeof msg.content === 'string') {
          state.assistant_text = msg.content;
          if (!state.conversation_id && typeof msg.conversation_id === 'string') {
            state.conversation_id = msg.conversation_id;
          }
          clearTimeout(timeout);
          resolve();
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  // Directive prompt that all but requires the model to use the web_search tool.
  const prompt = [
    'Use the web_search tool to look up the capital of Australia.',
    'Reply with exactly one sentence summarising the result (it should mention "Canberra").'
  ].join(' ');

  await new Promise((r) => setTimeout(r, 500));
  ws.send(JSON.stringify({ type: 'chat.message', content: prompt }));

  await waitForResponse;

  const deltaNames = state.deltas.map((d) => d.name);
  const doneNames = state.dones.map((d) => d.name);

  expect(deltaNames).toContain('web_search');
  expect(doneNames).toContain('web_search');

  expect(typeof state.assistant_text).toBe('string');
  expect((state.assistant_text || '').toLowerCase()).toContain('canberra');

  const conversation_id = state.conversation_id as string | undefined;
  expect(conversation_id).toBeTruthy();
  if (conversation_id) {
    await new Promise((r) => setTimeout(r, 500));
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
