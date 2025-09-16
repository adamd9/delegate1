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

test('assistant states its name (includes HK-47) and we finalize the conversation', async ({}, testInfo) => {
  test.slow();
  // Ensure websocket-server is up; otherwise skip gracefully.
  if (!(await serverReachable())) {
    testInfo.skip(`websocket-server not reachable at ${BASE_URL}. Start it first (e.g., npm run backend:dev) and ensure OPENAI_API_KEY is set.`);
    return;
  }

  await resetSessionIfPossible();

  const ws = new WebSocket(WS_URL);

  const responsePromise = new Promise<{ content: string; conversation_id: string }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for chat.response')), 50_000);

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data));
        // Accept only live assistant responses
        if (
          msg &&
          msg.type === 'chat.response' &&
          typeof msg.content === 'string' &&
          typeof msg.conversation_id === 'string'
        ) {
          clearTimeout(timeout);
          resolve({ content: msg.content, conversation_id: msg.conversation_id });
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

  // Wait for open then send a prompt that strongly biases output
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  const prompt = "Respond with exactly one sentence that clearly states your name and must include the exact substring 'HK-47'.";
  // Small delay so a human observer can follow along in a second client
  await new Promise((r) => setTimeout(r, 1000));
  ws.send(JSON.stringify({ type: 'chat.message', content: prompt }));

  const { content, conversation_id } = await responsePromise;

  // Assert the response includes HK-47 (persona is HK-47-lite)
  expect(content).toContain('HK-47');

  // Finalize this conversation and verify via REST
  // Small delay before finalize to allow reading the response live
  await new Promise((r) => setTimeout(r, 1000));
  ws.send(JSON.stringify({ type: 'conversation.end', conversation_id }));
  await new Promise((r) => setTimeout(r, 800));
  const res = await fetch(`${BASE_URL}/api/conversations?limit=5`);
  expect(res.ok).toBeTruthy();
  const conversations = (await res.json()) as Array<any>;
  const found = conversations.find((c) => c.id === conversation_id);
  expect(found).toBeTruthy();
  expect(found.ended_at).toBeTruthy();

  try { ws.close(); } catch {}
});
