import assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

async function main() {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'delegate-checkpoint-'));
  process.env.RUNTIME_DATA_DIR = runtimeDir;
  const realDateNow = Date.now;
  let clock = 1_000;
  Date.now = () => clock;

  const { conversationBus } = await import('../../src/memory/conversationBus');
  const sqlite = await import('../../src/db/sqlite');
  const observed: Array<{ turns: Array<{ role: string; text: string }> }> = [];
  conversationBus.onConversationCheckpoint(checkpoint => observed.push(checkpoint));
  assert.strictEqual(String(sqlite.getDb().pragma('journal_mode', { simple: true })).toLowerCase(), 'delete');

  sqlite.upsertSession('session-1');
  sqlite.upsertConversation({
    id: 'conversation-1',
    session_id: 'session-1',
    channel: 'text',
    started_at: '2020-01-01T00:00:00.000Z',
  });
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

  clock = 4_000;
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

  clock = 10_804_000;
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

  for (let index = 0; index < 4; index += 1) {
    sqlite.upsertConversation({
      id: `newer-conversation-${index}`,
      session_id: 'session-1',
      channel: 'text',
      started_at: new Date(Date.now() - 60_000 + index).toISOString(),
    });
  }
  assert.ok(
    (sqlite.listConversations(3) as Array<{ id: string }>).some(item => item.id === 'conversation-1'),
    'recent activity must keep an old resumed conversation inside the history limit',
  );

  const { replayHistoryOnConnect } = await import('../../src/session/history');
  const replayed: any[] = [];
  replayHistoryOnConnect({
    readyState: 1,
    send(data: string) { replayed.push(JSON.parse(data)); },
  } as any);
  const timeline = replayed.filter(event => event.type !== 'history.header' && event.type !== 'history.page');
  const historyPage = replayed.find(event => event.type === 'history.page');
  assert.strictEqual(historyPage.event_count, 8);
  assert.strictEqual(historyPage.has_more, false);
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
  const { ensureActivitySpan, closeActivitySpan } = await import('../../src/timeline/activity');
  session.currentActivitySpanId = undefined;
  session.currentActivitySpanKind = undefined;
  session.currentActivitySpanChannel = undefined;
  session.currentActivitySpanConversationId = undefined;
  clock = 10_805_000;
  const textSpanId = ensureActivitySpan('conversation-1', 'user', 'text');
  clock = 10_806_000;
  const voiceSpanId = ensureActivitySpan('conversation-1', 'voice', 'voice');
  assert.notStrictEqual(voiceSpanId, textSpanId);
  assert.strictEqual(session.currentActivitySpanId, voiceSpanId);
  assert.strictEqual(session.currentActivitySpanChannel, 'voice');
  const transitionEvents = sqlite.listConversationEvents('conversation-1').slice(-3) as any[];
  assert.deepStrictEqual(transitionEvents.map(event => event.kind), [
    'activity_span_started',
    'activity_span_closed',
    'activity_span_started',
  ]);
  assert.strictEqual(JSON.parse(transitionEvents[1].payload_json).reason, 'activity_changed');
  assert.strictEqual(
    sqlite.listConversationEvents('conversation-1').filter((event: any) => event.kind === 'conversation_checkpoint').length,
    2,
  );
  clock = 10_807_000;
  closeActivitySpan('conversation-1', 'voice_ended');

  sqlite.addConversationEvent({
    conversation_id: 'conversation-1',
    kind: 'context_capsule',
    payload: {
      text: 'The user expects the relationship timeline to remain continuous.',
      throughTimestampMs: 10_803_000,
      updatedAtMs: 10_804_000,
      source: 'token_threshold',
      channel: 'text',
    },
    created_at_ms: 10_804_000,
  });

  session.currentConversationId = undefined;
  session.currentActivitySpanId = undefined;
  session.currentActivitySpanKind = undefined;
  session.currentActivitySpanChannel = undefined;
  session.currentActivitySpanConversationId = undefined;
  session.conversationHistory = [];
  session.contextCapsule = undefined;
  session.thoughtflow = undefined;
  const { resumeOpenTimelineOnStartup } = await import('../../src/server/startup/continuity');
  resumeOpenTimelineOnStartup();
  assert.strictEqual(session.currentConversationId, 'conversation-1');
  assert.strictEqual((session as import('../../src/session/state').Session).thoughtflow?.sessionId, 'session-1');
  assert.deepStrictEqual(session.conversationHistory?.map(item => item.type), [
    'user', 'assistant', 'user', 'assistant',
  ]);
  assert.strictEqual(session.currentActivitySpanId, undefined);
  assert.deepStrictEqual(session.contextCapsule, {
    text: 'The user expects the relationship timeline to remain continuous.',
    throughTimestampMs: 10_803_000,
    updatedAtMs: 10_804_000,
    source: 'token_threshold',
  });

  session.previousResponseId = 'response-1';
  session.lastAssistantStepId = 'assistant-step-1';
  state.closeModel();
  assert.strictEqual(state.session.currentConversationId, 'conversation-1');
  assert.strictEqual(state.session.previousResponseId, 'response-1');
  assert.strictEqual(state.session.lastAssistantStepId, 'assistant-step-1');
  assert.strictEqual(state.session.conversationHistory?.length, 4);

  sqlite.upsertConversation({
    id: 'old-record',
    session_id: 'session-1',
    channel: 'text',
    started_at: new Date(20_000_000).toISOString(),
  });
  for (let index = 0; index < 6; index += 1) {
    sqlite.addConversationEvent({
      conversation_id: 'old-record',
      kind: 'message_user',
      payload: { text: `Old event ${index}`, channel: 'text' },
      created_at_ms: 20_000_000 + index,
    });
  }
  sqlite.upsertConversation({
    id: 'recent-record',
    session_id: 'session-1',
    channel: 'text',
    started_at: new Date(30_000_000).toISOString(),
  });
  sqlite.addConversationEvent({
    conversation_id: 'recent-record',
    kind: 'message_user',
    payload: { text: 'Recent question', channel: 'text' },
    created_at_ms: 30_000_000,
  });
  sqlite.addConversationEvent({
    conversation_id: 'recent-record',
    kind: 'message_assistant',
    payload: { text: 'Recent answer', channel: 'text' },
    created_at_ms: 30_000_001,
  });
  const recentPage = sqlite.listTimelineEvents(2);
  assert.deepStrictEqual(recentPage.events.map((event: any) => event.conversation_id), [
    'recent-record',
    'recent-record',
  ]);
  assert.strictEqual(recentPage.hasMore, true);
  assert.ok(recentPage.nextCursor);
  const firstPageIds = recentPage.events.map((event: any) => event.id);
  sqlite.addConversationEvent({
    conversation_id: 'recent-record',
    kind: 'message_user',
    payload: { text: 'Concurrent newest event', channel: 'text' },
    created_at_ms: 40_000_000,
  });
  const olderPage = sqlite.listTimelineEvents(3, recentPage.nextCursor!);
  assert.ok(olderPage.events.length > 0);
  assert.strictEqual(
    olderPage.events.some((event: any) => firstPageIds.includes(event.id)),
    false,
    'cursor pages must not duplicate the previous page',
  );
  assert.strictEqual(
    olderPage.events.some((event: any) => event.created_at_ms === 40_000_000),
    false,
    'events inserted after page one must not shift the older cursor page',
  );

  sqlite.upsertConversation({
    id: 'span-page-record',
    session_id: 'session-1',
    channel: 'text',
    started_at: new Date(50_000_000).toISOString(),
  });
  for (const [offset, kind, payload] of [
    [0, 'activity_span_started', { span_id: 'page-span', kind: 'user', channel: 'text' }],
    [1, 'message_user', { text: 'Paged question', channel: 'text' }],
    [2, 'message_assistant', { text: 'Paged answer', channel: 'text' }],
    [3, 'activity_span_closed', { span_id: 'page-span', reason: 'idle', channel: 'text' }],
  ] as const) {
    sqlite.addConversationEvent({
      conversation_id: 'span-page-record', kind, payload,
      created_at_ms: 50_000_000 + offset,
    });
  }
  const spanAlignedPage = sqlite.listTimelineEvents(2);
  assert.deepStrictEqual(spanAlignedPage.events.map((event: any) => event.kind), [
    'activity_span_started', 'message_user', 'message_assistant', 'activity_span_closed',
  ]);

  const contextEvents: any[] = [];
  const activeSession = state.session;
  activeSession.currentConversationId = 'conversation-1';
  activeSession.currentRequest = undefined;
  activeSession.previousResponseId = 'response-before-manual-compaction';
  activeSession.contextCompactionInFlight = false;
  activeSession.openaiClient = {
    responses: {
      compact: async (body: any) => ({
        id: 'compaction-1',
        output: [{ type: 'compaction', encrypted_content: 'compact-state' }],
        usage: { input_tokens: 50_000, output_tokens: 100, total_tokens: 50_100 },
        request: body,
      }),
      create: async () => ({
        output_text: 'The relationship timeline and current work remain continuous.',
        usage: { input_tokens: 200, output_tokens: 20, total_tokens: 220 },
      }),
    },
  };
  const { compactCurrentContext } = await import('../../src/session/contextControl');
  const compactedStatus = await compactCurrentContext(event => contextEvents.push(event));
  assert.strictEqual(activeSession.previousResponseId, undefined);
  assert.deepStrictEqual(activeSession.pendingCompactedInput, [
    { type: 'compaction', encrypted_content: 'compact-state' },
  ]);
  assert.strictEqual(activeSession.contextCapsule?.source, 'manual_compaction');
  assert.strictEqual(compactedStatus.latestCompaction?.source, 'manual');
  assert.deepStrictEqual(contextEvents.map(event => `${event.type}:${event.phase || event.source}`), [
    'context.capsule:started',
    'context.compacted:manual',
    'context.capsule:completed',
  ]);

  sqlite.getDb().close();
  Date.now = realDateNow;
  rmSync(runtimeDir, { recursive: true, force: true });
  console.log('conversation checkpoint tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
