import { getAgent } from '../agentConfigs';
import { addConversationEvent } from '../db/sqlite';
import { createOpenAIClient } from '../services/openaiClient';
import { getResponsesCompactThresholdTokens, normalizeTokenUsage, writeContextCapsule } from './contextPolicy';
import { session, type Session } from './state';

export type ContextStatus = {
  active: boolean;
  channel: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  compactThresholdTokens: number;
  thresholdUtilizationPercent: number;
  usageRecordedAtMs: number | null;
  compactionInFlight: boolean;
  canCompact: boolean;
  latestCompaction: Session['latestContextCompaction'] | null;
  capsule: {
    active: boolean;
    source: string | null;
    updatedAtMs: number | null;
    throughTimestampMs: number | null;
  };
};

export function getContextStatus(state: Session = session): ContextStatus {
  const threshold = getResponsesCompactThresholdTokens();
  const usage = state.latestModelUsage;
  const inputTokens = usage?.inputTokens || 0;
  return {
    active: Boolean(state.currentConversationId),
    channel: usage?.channel || null,
    inputTokens,
    outputTokens: usage?.outputTokens || 0,
    cachedTokens: usage?.cachedTokens || 0,
    compactThresholdTokens: threshold,
    thresholdUtilizationPercent: threshold > 0
      ? Math.round((inputTokens / threshold) * 1_000) / 10
      : 0,
    usageRecordedAtMs: usage?.recordedAtMs || null,
    compactionInFlight: state.contextCompactionInFlight === true,
    canCompact: Boolean(
      state.currentConversationId
      && state.previousResponseId
      && !state.currentRequest
      && !state.contextCompactionInFlight
    ),
    latestCompaction: state.latestContextCompaction || null,
    capsule: {
      active: Boolean(state.contextCapsule?.text),
      source: state.contextCapsule?.source || null,
      updatedAtMs: state.contextCapsule?.updatedAtMs || null,
      throughTimestampMs: state.contextCapsule?.throughTimestampMs || null,
    },
  };
}

export async function compactCurrentContext(
  broadcast: (event: Record<string, unknown>) => void,
): Promise<ContextStatus> {
  if (session.contextCompactionInFlight) throw new Error('Context compaction is already in progress.');
  if (session.currentRequest) throw new Error('Wait for the active response to finish before compacting context.');
  if (!session.currentConversationId || !session.previousResponseId) {
    throw new Error('There is no active Responses context to compact.');
  }

  const conversationId = session.currentConversationId;
  const previousResponseId = session.previousResponseId;
  const history = [...(session.conversationHistory || [])];
  const throughTimestampMs = history.reduce((latest, item) => Math.max(latest, item.timestamp), 0);
  const model = getAgent('base').textModel || getAgent('base').model || 'gpt-5-mini';
  const startedAtMs = Date.now();
  session.contextCompactionInFlight = true;
  broadcast({
    type: 'context.capsule', phase: 'started', conversation_id: conversationId,
    channel: 'text', source: 'manual_compaction', timestamp: startedAtMs,
  });

  try {
    if (!session.openaiClient) session.openaiClient = createOpenAIClient();
    const compacted = await session.openaiClient.responses.compact({
      model,
      previous_response_id: previousResponseId,
    });
    if (!Array.isArray(compacted.output) || compacted.output.length === 0) {
      throw new Error('Responses compaction returned no replacement input.');
    }
    const usage = normalizeTokenUsage(compacted.usage);
    session.pendingCompactedInput = compacted.output;
    session.previousResponseId = undefined;
    session.latestContextCompaction = {
      atMs: Date.now(), channel: 'text', protocol: 'responses', source: 'manual',
    };
    if (usage) {
      session.latestModelUsage = { channel: 'text', ...usage, recordedAtMs: Date.now() };
    }
    addConversationEvent({
      conversation_id: conversationId,
      kind: 'context_compacted',
      payload: {
        channel: 'text', protocol: 'responses', source: 'manual',
        compaction_id: compacted.id, usage,
      },
    });
    broadcast({
      type: 'context.compacted', conversation_id: conversationId, channel: 'text',
      protocol: 'responses', source: 'manual', timestamp: Date.now(),
    });

    try {
      const capsule = await writeContextCapsule({
        createResponse: body => session.openaiClient!.responses.create(body),
        model,
        history,
      });
      if (capsule.text) {
        session.contextCapsule = {
          text: capsule.text,
          throughTimestampMs,
          updatedAtMs: Date.now(),
          source: 'manual_compaction',
        };
        addConversationEvent({
          conversation_id: conversationId,
          kind: 'context_capsule',
          payload: { ...session.contextCapsule, channel: 'text', usage: capsule.usage },
        });
      }
      broadcast({
        type: 'context.capsule', phase: 'completed', conversation_id: conversationId,
        channel: 'text', source: 'manual_compaction', throughTimestampMs, timestamp: Date.now(),
      });
    } catch (error: any) {
      console.warn('[context] Manual compaction succeeded but capsule refresh failed:', error?.message || error);
      broadcast({
        type: 'context.capsule', phase: 'failed', conversation_id: conversationId,
        channel: 'text', source: 'manual_compaction', timestamp: Date.now(),
      });
    }
  } catch (error) {
    broadcast({
      type: 'context.capsule', phase: 'failed', conversation_id: conversationId,
      channel: 'text', source: 'manual_compaction', timestamp: Date.now(),
    });
    throw error;
  } finally {
    session.contextCompactionInFlight = false;
  }

  return getContextStatus();
}