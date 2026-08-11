import assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

async function main() {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'delegate-checkpoint-'));
  process.env.RUNTIME_DATA_DIR = runtimeDir;

  const { conversationBus } = await import('../../src/memory/conversationBus');
  const sqlite = await import('../../src/db/sqlite');
  const observed: Array<{ turns: Array<{ role: string; text: string }> }> = [];
  conversationBus.onConversationCheckpoint(checkpoint => observed.push(checkpoint));

  sqlite.upsertSession('session-1');
  sqlite.upsertConversation({ id: 'conversation-1', session_id: 'session-1', channel: 'text' });
  sqlite.addConversationEvent({
    conversation_id: 'conversation-1',
    kind: 'activity_span_started',
    payload: { span_id: 'span-1', kind: 'user', channel: 'text' },
    created_at_ms: 1_000,
  });
  sqlite.addConversationEvent({
    conversation_id: 'conversation-1',
    kind: 'message_user',
    payload: { text: 'First question', channel: 'text' },
    created_at_ms: 2_000,
  });
  sqlite.addConversationEvent({
    conversation_id: 'conversation-1',
    kind: 'message_assistant',
    payload: { text: 'First answer', channel: 'text' },
    created_at_ms: 3_000,
  });

  assert.deepStrictEqual(sqlite.checkpointConversation('conversation-1', 'idle'), {
    checkpointSeq: 3,
    turnCount: 2,
  });
  assert.strictEqual(sqlite.checkpointConversation('conversation-1', 'idle'), null);

  sqlite.addConversationEvent({
    conversation_id: 'conversation-1',
    kind: 'activity_span_started',
    payload: { span_id: 'span-2', kind: 'user', channel: 'text' },
    created_at_ms: 10_801_000,
  });
  sqlite.addConversationEvent({
    conversation_id: 'conversation-1',
    kind: 'message_user',
    payload: { text: 'Several hours later', channel: 'text' },
    created_at_ms: 10_802_000,
  });
  sqlite.addConversationEvent({
    conversation_id: 'conversation-1',
    kind: 'message_assistant',
    payload: { text: 'Continuing the same thread', channel: 'text' },
    created_at_ms: 10_803_000,
  });

  assert.deepStrictEqual(sqlite.checkpointConversation('conversation-1', 'idle'), {
    checkpointSeq: 7,
    turnCount: 2,
  });
  assert.deepStrictEqual(observed.map(item => item.turns.map(turn => turn.text)), [
    ['First question', 'First answer'],
    ['Several hours later', 'Continuing the same thread'],
  ]);

  const conversation = sqlite.getDb().prepare(
    'SELECT ended_at, status, last_checkpoint_seq FROM conversations WHERE id = ?'
  ).get('conversation-1') as { ended_at: string | null; status: string; last_checkpoint_seq: number };
  assert.strictEqual(conversation.ended_at, null);
  assert.strictEqual(conversation.status, 'open');
  assert.strictEqual(conversation.last_checkpoint_seq, 7);

  const checkpointEvents = sqlite.listConversationEvents('conversation-1')
    .filter((event: any) => event.kind === 'conversation_checkpoint');
  assert.strictEqual(checkpointEvents.length, 2);

  const { replayHistoryOnConnect } = await import('../../src/session/history');
  const replayed: any[] = [];
  replayHistoryOnConnect({
    readyState: 1,
    send(data: string) { replayed.push(JSON.parse(data)); },
  } as any);
  const timeline = replayed.filter(event => event.type !== 'history.header');
  assert.deepStrictEqual(timeline.map(event => event.type), [
    'timeline.span.started',
    'conversation.item.created',
    'conversation.item.created',
    'timeline.checkpoint',
    'timeline.span.closed',
    'timeline.span.started',
    'conversation.item.created',
    'conversation.item.created',
    'timeline.checkpoint',
    'timeline.span.closed',
  ]);
  assert.strictEqual(timeline[0].span_id, 'span-1');
  assert.strictEqual(timeline[5].span_id, 'span-2');
  assert.strictEqual(timeline[5].timestamp, 10_801_000);
  assert.ok(timeline[5].timestamp - timeline[0].timestamp >= 10_800_000);

  const state = await import('../../src/session/state');
  const { session } = state;
  session.currentConversationId = undefined;
  session.currentActivitySpanId = undefined;
  session.conversationHistory = [];
  session.thoughtflow = undefined;
  const { resumeOpenTimelineOnStartup } = await import('../../src/server/startup/continuity');
  resumeOpenTimelineOnStartup();
  assert.strictEqual(session.currentConversationId, 'conversation-1');
  assert.strictEqual((session as import('../../src/session/state').Session).thoughtflow?.sessionId, 'session-1');
  assert.deepStrictEqual(session.conversationHistory?.map(item => item.type), [
    'user', 'assistant', 'user', 'assistant',
  ]);
  assert.strictEqual(session.currentActivitySpanId, undefined);

  session.previousResponseId = 'response-1';
  session.lastAssistantStepId = 'assistant-step-1';
  state.closeModel();
  assert.strictEqual(state.session.currentConversationId, 'conversation-1');
  assert.strictEqual(state.session.previousResponseId, 'response-1');
  assert.strictEqual(state.session.lastAssistantStepId, 'assistant-step-1');
  assert.strictEqual(state.session.conversationHistory?.length, 4);

  sqlite.getDb().close();
  rmSync(runtimeDir, { recursive: true, force: true });
  console.log('conversation checkpoint tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
