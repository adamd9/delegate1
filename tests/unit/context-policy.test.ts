import assert from 'assert';
import {
  buildContinuityContext,
  getResponsesCompactThresholdTokens,
  getRealtimeTruncation,
  getResponsesContextManagement,
  normalizeTokenUsage,
  responseContainsCompaction,
  shouldRefreshContextCapsule,
  writeContextCapsule,
} from '../../src/session/contextPolicy';
import { getContextStatus } from '../../src/session/contextControl';
import type { Session } from '../../src/session/state';

async function main() {
  process.env.RESPONSES_COMPACT_THRESHOLD_TOKENS = '64000';
  process.env.REALTIME_CONTEXT_RETENTION_RATIO = '0.75';
  process.env.CONTEXT_CAPSULE_TRIGGER_TOKENS = '1000';

  assert.deepStrictEqual(getResponsesContextManagement(), [
    { type: 'compaction', compact_threshold: 64_000 },
  ]);
  assert.strictEqual(getResponsesCompactThresholdTokens(), 64_000);
  assert.deepStrictEqual(getRealtimeTruncation(), {
    type: 'retention_ratio',
    retention_ratio: 0.75,
  });
  assert.deepStrictEqual(normalizeTokenUsage({
    input_tokens: 1_200,
    output_tokens: 80,
    total_tokens: 1_280,
    input_token_details: { cached_tokens: 900 },
  }), {
    inputTokens: 1_200,
    outputTokens: 80,
    totalTokens: 1_280,
    cachedTokens: 900,
  });
  assert.strictEqual(responseContainsCompaction({ output: [{ type: 'compaction' }] }), true);

  const state: Session = {
    conversationHistory: [
      { type: 'user', content: 'Old question', timestamp: 100, channel: 'text' },
      { type: 'assistant', content: 'Old answer', timestamp: 200, channel: 'text' },
      { type: 'user', content: 'Voice follow-up', timestamp: 300, channel: 'voice' },
      { type: 'assistant', content: 'Voice answer', timestamp: 400, channel: 'voice' },
    ],
  };
  assert.strictEqual(shouldRefreshContextCapsule(state, normalizeTokenUsage({ input_tokens: 1_200 }), false), true);

  state.contextCapsule = {
    text: 'The user asked an old question and received an answer.',
    throughTimestampMs: 200,
    updatedAtMs: 250,
    source: 'token_threshold',
  };
  const continuity = buildContinuityContext(state);
  assert.match(continuity, /Durable context capsule/);
  assert.match(continuity, /User \(voice\): Voice follow-up/);
  assert.doesNotMatch(continuity, /Old question/);
  assert.strictEqual(shouldRefreshContextCapsule(state, normalizeTokenUsage({ input_tokens: 1_200 }), false), false);

  let capsuleRequest: any;
  const capsule = await writeContextCapsule({
    model: 'gpt-5-mini',
    history: state.conversationHistory,
    createResponse: async body => {
      capsuleRequest = body;
      return {
        output_text: '  User has an unresolved voice follow-up.  ',
        usage: { input_tokens: 200, output_tokens: 20, total_tokens: 220 },
      };
    },
  });
  assert.strictEqual(capsuleRequest.store, false);
  assert.strictEqual(capsuleRequest.tools, undefined);
  assert.strictEqual(capsule.text, 'User has an unresolved voice follow-up.');
  assert.strictEqual(capsule.usage?.totalTokens, 220);

  const status = getContextStatus({
    currentConversationId: 'conversation-1',
    previousResponseId: 'response-1',
    latestModelUsage: {
      channel: 'text', inputTokens: 32_000, outputTokens: 250,
      totalTokens: 32_250, cachedTokens: 20_000, recordedAtMs: 500,
    },
    contextCapsule: state.contextCapsule,
  });
  assert.strictEqual(status.thresholdUtilizationPercent, 50);
  assert.strictEqual(status.canCompact, true);
  assert.strictEqual(status.capsule.active, true);

  console.log('context policy tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});