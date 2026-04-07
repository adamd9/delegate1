import { createOpenAIClient } from '../services/openaiClient';
import type { ContextTurn } from './index';

const ARBITRATOR_SYSTEM_PROMPT = `You are a memory relevance filter. You receive a list of retrieved memories and the current conversation context. Your job is to keep ONLY the memories that are genuinely relevant to the current conversation — memories the assistant would actually need to respond well.

Rules:
- KEEP memories that directly relate to what the user is currently discussing or asking about.
- KEEP memories that provide important personal context for the current topic (e.g. user preferences relevant to a current request).
- REMOVE memories that are about completely unrelated topics, even if they share surface-level keywords.
- REMOVE memories that are generic or stale and add no value to the current exchange.
- When in doubt, REMOVE — it is better to under-retrieve than to confuse the assistant with noise.
- Return ONLY the kept memory lines, one per line, preserving the original "- " prefix format.
- If NO memories are relevant, return exactly: NONE`;

export interface ArbitratorResult {
  /** Filtered memory string (same "- " line format), or null if none relevant */
  filtered: string | null;
  /** Individual memories that were kept */
  kept: string[];
  /** Individual memories that were removed */
  removed: string[];
  /** Whether the result was produced by the LLM (vs. a timeout fallback) */
  timedOut: boolean;
}

/**
 * Uses a fast LLM to filter retrieved memories for relevance against
 * the current conversation context.
 *
 * Returns a detailed result with kept/removed breakdowns.
 */
export async function filterMemoriesWithArbitrator(opts: {
  currentMessage: string;
  conversationHistory: ContextTurn[];
  retrievedMemories: string;
  model: string;
  timeoutMs: number;
}): Promise<ArbitratorResult> {
  const { currentMessage, conversationHistory, retrievedMemories, model, timeoutMs } = opts;

  const client = createOpenAIClient();

  // Build a compact conversation context for the arbitrator
  const contextLines: string[] = [];
  const recentTurns = conversationHistory.slice(-4);
  for (const turn of recentTurns) {
    const prefix = turn.role === 'user' ? 'User' : 'Assistant';
    const text = turn.text.length > 300 ? turn.text.slice(0, 297) + '…' : turn.text;
    contextLines.push(`${prefix}: ${text}`);
  }
  const contextBlock = contextLines.length > 0
    ? `Recent conversation:\n${contextLines.join('\n')}\n\n`
    : '';

  const userPrompt =
    `${contextBlock}Current user message:\n${currentMessage}\n\n` +
    `Retrieved memories:\n${retrievedMemories}\n\n` +
    `Return only the relevant memories (preserving the "- " format), or NONE if none are relevant.`;

  const TIMEOUT = Symbol('timeout');
  const timeoutPromise = new Promise<typeof TIMEOUT>(resolve =>
    setTimeout(() => resolve(TIMEOUT), timeoutMs)
  );

  const llmPromise = client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: ARBITRATOR_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 400,
    temperature: 0,
  });

  const result = await Promise.race([llmPromise, timeoutPromise]);

  const inputLines = retrievedMemories.split('\n').map(l => l.trim()).filter(Boolean);

  if (result === TIMEOUT) {
    console.warn(`[arbitrator] timed out after ${timeoutMs}ms, returning unfiltered`);
    return { filtered: retrievedMemories, kept: inputLines, removed: [], timedOut: true };
  }

  const response = result as Awaited<typeof llmPromise>;
  const text = response.choices?.[0]?.message?.content?.trim() || '';

  if (!text || text === 'NONE' || text.startsWith('NONE')) {
    return { filtered: null, kept: [], removed: inputLines, timedOut: false };
  }

  // Parse and validate: keep only lines that look like memory items
  const keptLines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- ') && l.length > 3);

  const keptSet = new Set(keptLines);
  const removedLines = inputLines.filter(l => !keptSet.has(l));

  const filtered = keptLines.length > 0 ? keptLines.join('\n') : null;
  return { filtered, kept: keptLines, removed: removedLines, timedOut: false };
}
