import type { ConversationItem, Session } from './state';

const DEFAULT_RESPONSES_COMPACT_THRESHOLD = 120_000;
const DEFAULT_CAPSULE_TRIGGER_TOKENS = 24_000;
const DEFAULT_RECENT_TURNS = 8;
const DEFAULT_CAPSULE_SOURCE_TURNS = 40;
const MAX_TURN_CHARS = 1_200;

export type ModelTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getResponsesContextManagement() {
  return [{
    type: 'compaction',
    compact_threshold: positiveInteger(
      process.env.RESPONSES_COMPACT_THRESHOLD_TOKENS,
      DEFAULT_RESPONSES_COMPACT_THRESHOLD,
    ),
  }];
}

export function getRealtimeTruncation() {
  const configuredRatio = Number(process.env.REALTIME_CONTEXT_RETENTION_RATIO);
  const retentionRatio = Number.isFinite(configuredRatio) && configuredRatio > 0 && configuredRatio < 1
    ? configuredRatio
    : 0.8;
  return { type: 'retention_ratio' as const, retention_ratio: retentionRatio };
}

export function normalizeTokenUsage(usage: any): ModelTokenUsage | null {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  const totalTokens = Number(usage.total_tokens) || inputTokens + outputTokens;
  const cachedTokens = Number(
    usage.input_tokens_details?.cached_tokens
      ?? usage.input_token_details?.cached_tokens
      ?? 0,
  ) || 0;
  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) return null;
  return { inputTokens, outputTokens, totalTokens, cachedTokens };
}

export function responseContainsCompaction(response: any): boolean {
  return Array.isArray(response?.output)
    && response.output.some((item: any) => item?.type === 'compaction');
}

function conversationTurns(history: ConversationItem[] | undefined) {
  return (history || []).filter(
    (item): item is Extract<ConversationItem, { type: 'user' | 'assistant' }> =>
      item.type === 'user' || item.type === 'assistant',
  );
}

function renderTurns(turns: Array<Extract<ConversationItem, { type: 'user' | 'assistant' }>>): string {
  return turns.map(turn => {
    const role = turn.type === 'user' ? 'User' : 'Assistant';
    const channel = turn.channel ? ` (${turn.channel})` : '';
    return `${role}${channel}: ${turn.content.slice(0, MAX_TURN_CHARS)}`;
  }).join('\n');
}

export function buildContinuityContext(state: Session): string {
  const turns = conversationTurns(state.conversationHistory);
  const recentTurns = turns
    .filter(turn => !state.contextCapsule || turn.timestamp > state.contextCapsule.throughTimestampMs)
    .slice(-positiveInteger(process.env.CONTEXT_RECENT_TURNS, DEFAULT_RECENT_TURNS));
  if (!state.contextCapsule && recentTurns.length === 0) return '';

  const parts = [
    '[Relationship continuity context - established history, not a new user message]',
    state.contextCapsule ? `Durable context capsule:\n${state.contextCapsule.text}` : '',
    recentTurns.length ? `Recent verbatim turns:\n${renderTurns(recentTurns)}` : '',
  ].filter(Boolean);
  return `${parts.join('\n\n')}\n\n`;
}

export function shouldRefreshContextCapsule(
  state: Session,
  usage: ModelTokenUsage | null,
  compacted: boolean,
): boolean {
  const turns = conversationTurns(state.conversationHistory);
  if (turns.length < 4 || state.contextCompactionInFlight) return false;
  const turnsAfterCapsule = state.contextCapsule
    ? turns.filter(turn => turn.timestamp > state.contextCapsule!.throughTimestampMs).length
    : turns.length;
  if (turnsAfterCapsule < 4) return false;
  return compacted || (usage?.inputTokens || 0) >= positiveInteger(
    process.env.CONTEXT_CAPSULE_TRIGGER_TOKENS,
    DEFAULT_CAPSULE_TRIGGER_TOKENS,
  );
}

export function buildCapsuleSource(history: ConversationItem[] | undefined): string {
  const turns = conversationTurns(history)
    .slice(-positiveInteger(process.env.CONTEXT_CAPSULE_SOURCE_TURNS, DEFAULT_CAPSULE_SOURCE_TURNS));
  return renderTurns(turns);
}

export async function writeContextCapsule(options: {
  createResponse: (body: any) => Promise<any>;
  model: string;
  history: ConversationItem[] | undefined;
}): Promise<{ text: string; usage: ModelTokenUsage | null }> {
  const source = buildCapsuleSource(options.history);
  if (!source) return { text: '', usage: null };
  const response = await options.createResponse({
    model: options.model,
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: 1_200,
    input: [
      {
        role: 'developer',
        content: 'Write a compact continuity capsule for another assistant continuing this same relationship. Preserve concrete facts, commitments, unresolved work, user preferences, corrections, and cross-channel context. Distinguish what the user said from what the assistant said or did. Omit greetings, repetition, and process commentary. Do not address the user.',
      },
      { role: 'user', content: source },
    ],
  });
  return {
    text: String(response?.output_text || '').trim(),
    usage: normalizeTokenUsage(response?.usage),
  };
}