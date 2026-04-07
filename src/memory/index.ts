import { getMemoryBackend } from './backends';
import { conversationBus } from './conversationBus';
import { getMemoryConfig } from './memoryConfig';
import type {} from './types'; // CompletedConversation used via namespace import below
import { createOpenAIClient } from '../services/openaiClient';
import { chatClients } from '../ws/clients';
import { addConversationEvent } from '../db/sqlite';
import { appendEvent, ensureSession } from '../observability/thoughtflow';
import { MemoryDeduplicator, formatMemoryItems } from './deduplicator';
import { filterMemoriesWithArbitrator, type ArbitratorResult } from './arbitrator';

/** Minimal turn shape for building context queries — callers pass their own history items. */
export interface ContextTurn {
  role: 'user' | 'assistant';
  text: string;
}

const EXTRACTION_SYSTEM_PROMPT = `You extract two kinds of durable facts from a completed conversation between a user and an AI assistant.

## A. Personal facts about the user
Rules:
- Only extract facts explicitly stated or clearly confirmed by the USER, not inferred or suggested by the assistant.
- Only include facts that are stable and long-lived: name, location, profession, relationships, firm preferences, accessibility needs, recurring patterns.
- DO NOT store: transient discussion topics, questions the assistant asked, options the assistant offered, facts the assistant assumed, speculative or unconfirmed details.

## B. Operational lessons (how to do things better)
Extract an insight ONLY when the assistant initially failed or under-performed and then arrived at a successful outcome after:
  - the user explicitly corrected the assistant, OR
  - the user had to prompt multiple times or rephrase before getting the desired result.
Rules:
- Capture WHAT went wrong and WHAT the successful approach was, so the assistant can use the right approach next time.
- Focus on: tool usage patterns, query formulation, correct parameters, preferred workflows, formatting expectations, or any other repeatable technique.
- Frame each insight as a reusable instruction (e.g. "When the user asks X, use tool Y with parameter Z" or "Always confirm X before doing Y").
- DO NOT store lessons when the assistant handled the request well on the first attempt — only store lessons from corrections or repeated prompting.
- DO NOT store vague observations; each insight must be specific and actionable.

## Self-containment (CRITICAL)
Every fact or insight you produce will be stored in a database and retrieved later WITHOUT the original conversation.
Therefore each line MUST be fully self-contained and meaningful on its own:
- NEVER use dangling references like "that context", "this situation", "in that case", "the topic above", etc.
- ALWAYS inline the specific subject matter. Instead of "respond with X in that context" write "When asked about [specific topic], respond with X".
- A reader with NO access to the conversation must understand exactly what the fact means.

## Output format
- Each fact or insight must be a single plain-text line starting with "- ".
- If there are no qualifying facts or insights in either category, return exactly: NONE`;

/** Jaccard similarity between two query strings (word-set overlap). */
function queryOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const tokenize = (s: string) => new Set(s.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Build a context-enriched query by prepending recent conversation turns to
 * the current user message. This gives the embedding/search backend richer
 * context so it can retrieve more relevant memories.
 *
 * Returns the original `currentMessage` unchanged when the context window is
 * disabled (turns=0) or no history is available.
 */
export function buildContextQuery(
  currentMessage: string,
  history: ContextTurn[] | undefined,
  maxTurns: number,
  maxChars: number
): string {
  if (!history || history.length === 0 || maxTurns <= 0 || maxChars <= 0) {
    return currentMessage;
  }

  // Take the most recent N turns (excluding the current message which is separate)
  const recentTurns = history.slice(-maxTurns);

  // Build compact transcript, newest last, within char budget
  const lines: string[] = [];
  let totalChars = 0;
  // Walk from oldest to newest so we can trim from the oldest end
  for (const turn of recentTurns) {
    const prefix = turn.role === 'user' ? 'U' : 'A';
    // Truncate very long individual turns
    const text = turn.text.length > 400 ? turn.text.slice(0, 397) + '…' : turn.text;
    const line = `${prefix}: ${text}`;
    if (totalChars + line.length > maxChars) break;
    lines.push(line);
    totalChars += line.length;
  }

  if (lines.length === 0) return currentMessage;

  return `[Recent conversation]\n${lines.join('\n')}\n\n[Current message]\n${currentMessage}`;
}

class MemoryModule {
  private _openaiClient: any = null;
  private _cachedMemories: string | null = null;
  private _cachedQuery: string = '';
  private _cacheUpdatedAt: number = 0;
  private _inflightRetrieve: Promise<string | null> | null = null;
  private _dedup: MemoryDeduplicator = new MemoryDeduplicator();

  constructor() {
    conversationBus.onConversationComplete((conv) => {
      this._extractAndStore(conv).catch(() => {});
      // Reset deduplicator state so the next conversation starts fresh
      this._dedup.reset();
    });
  }

  private get openaiClient() {
    if (!this._openaiClient) {
      try { this._openaiClient = createOpenAIClient(); } catch {}
    }
    return this._openaiClient;
  }

  private _broadcast(event: Record<string, unknown>): void {
    const msg = JSON.stringify(event);
    for (const ws of chatClients) {
      if (ws.readyState === 1 /* OPEN */) ws.send(msg);
    }
  }

  private _persist(conversationId: string, kind: string, payload: Record<string, unknown>, ts: number): void {
    try { addConversationEvent({ conversation_id: conversationId, kind, payload, created_at_ms: ts }); } catch {}
  }

  private _thoughtflowStep(conversationId: string, label: string, payload: Record<string, unknown>, ts: number): void {
    try {
      ensureSession();
      const stepId = `step_${label.replace(/\./g, '_')}_${ts}`;
      appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: stepId, label, payload, timestamp: ts });
      appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: stepId, payload, timestamp: ts + 1 });
    } catch {}
  }

  /**
   * Retrieve relevant memories.
   *
   * Stale-while-revalidate:
   * - If cache is warm, return it immediately (0ms) and kick off a background refresh.
   * - If cache is cold, race Mem0 against the timeout. If Mem0 wins, cache and return.
   *   If timeout wins, return null for this turn but let the Mem0 fetch continue running
   *   in the background so it populates the cache for the next turn.
   */
  async retrieve(query: string, timeoutMs?: number, conversationId?: string): Promise<string | null> {
    const backend = getMemoryBackend();
    if (!backend.available) return null;

    // Warm cache — return immediately if the new query is topically related; otherwise bust
    if (this._cachedMemories !== null) {
      const similarity = queryOverlap(query, this._cachedQuery);
      const ageMs = Date.now() - this._cacheUpdatedAt;
      if (similarity >= 0.15) {
        const lines = this._cachedMemories.split('\n').filter(Boolean);
        console.log(`[memory] retrieve — cache hit (age: ${ageMs}ms, overlap: ${similarity.toFixed(2)}), returning immediately`);
        const cachets = Date.now();
        this._broadcast({ type: 'memory.retrieved', count: lines.length, memories: this._cachedMemories, source: 'cache', age_ms: ageMs, timestamp: cachets });
        if (conversationId) {
          this._persist(conversationId, 'memory_retrieved', { source: 'cache', count: lines.length, age_ms: ageMs }, cachets);
          this._thoughtflowStep(conversationId, 'memory.retrieve', { source: 'cache', count: lines.length }, cachets);
        }
        this._kickBackgroundRefresh(backend, query);
        return this._cachedMemories;
      }
      console.log(`[memory] retrieve — cache bust (overlap: ${similarity.toFixed(2)} < 0.15), doing fresh search`);
      this._cachedMemories = null;
      this._cachedQuery = '';
    }

    if (!query.trim()) return null;

    const effectiveTimeout = timeoutMs ?? getMemoryConfig().retrieve_timeout_ms;
    console.log(`[memory] retrieve — cold cache, query: "${query.slice(0, 80)}${query.length > 80 ? '…' : ''}" timeout: ${effectiveTimeout}ms`);

    const start = Date.now();

    // Start (or reuse) the in-flight backend fetch; it always runs to completion so it can populate the cache
    let timedOut = false;
    if (!this._inflightRetrieve) {
      this._inflightRetrieve = backend.retrieve(query, 5)
        .then(result => {
          this._inflightRetrieve = null;
          if (result !== null) {
            this._cachedMemories = result;
            this._cachedQuery = query;
            this._cacheUpdatedAt = Date.now();
            const lines = result.split('\n').filter(Boolean);
            if (timedOut) {
              console.log(`[memory] retrieve — late result (${lines.length} result(s)), broadcasting for UI`);
              const latets = Date.now();
              this._broadcast({ type: 'memory.retrieved', count: lines.length, memories: result, source: 'late', elapsed_ms: latets - start, timestamp: latets });
              if (conversationId) {
                this._persist(conversationId, 'memory_retrieved', { source: 'late', count: lines.length, elapsed_ms: latets - start }, latets);
                this._thoughtflowStep(conversationId, 'memory.retrieve', { source: 'late', count: lines.length }, latets);
              }
            } else {
              console.log(`[memory] retrieve — cache populated (${lines.length} result(s), will be used next turn)`);
            }
          } else {
            console.log('[memory] retrieve — backend returned no results (cache stays cold)');
            if (timedOut) {
              const missts = Date.now();
              this._broadcast({ type: 'memory.miss', timestamp: missts });
              if (conversationId) this._persist(conversationId, 'memory_miss', {}, missts);
            }
          }
          return result;
        })
        .catch(e => {
          this._inflightRetrieve = null;
          console.warn('[memory] retrieve — backend fetch error:', e?.message || e);
          return null;
        });
    }

    // Use a sentinel so we can distinguish "backend returned null (no results)" from "timeout fired"
    const TIMEOUT = Symbol('timeout');
    const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) =>
      setTimeout(() => resolve(TIMEOUT), effectiveTimeout)
    );

    const raceResult = await Promise.race([this._inflightRetrieve!, timeoutPromise]);

    if (raceResult === TIMEOUT) {
      // Genuine timeout — backend is still running in background
      timedOut = true;
      const pendingts = Date.now();
      console.log(`[memory] retrieve — timed out after ${pendingts - start}ms; fetch continues in background for next turn`);
      this._broadcast({ type: 'memory.pending', elapsed_ms: effectiveTimeout, timestamp: pendingts });
      if (conversationId) {
        this._persist(conversationId, 'memory_pending', { elapsed_ms: effectiveTimeout }, pendingts);
        this._thoughtflowStep(conversationId, 'memory.retrieve', { source: 'timeout', elapsed_ms: effectiveTimeout }, pendingts);
      }
      return null;
    }

    // Backend completed (result is string | null)
    const result = raceResult as string | null;
    if (result !== null) {
      const lines = result.split('\n').filter(Boolean);
      const freshts = Date.now();
      console.log(`[memory] retrieve — got ${lines.length} result(s) in ${freshts - start}ms`);
      this._broadcast({ type: 'memory.retrieved', count: lines.length, memories: result, source: 'fresh', elapsed_ms: freshts - start, timestamp: freshts });
      if (conversationId) {
        this._persist(conversationId, 'memory_retrieved', { source: 'fresh', count: lines.length, elapsed_ms: freshts - start }, freshts);
        this._thoughtflowStep(conversationId, 'memory.retrieve', { source: 'fresh', count: lines.length }, freshts);
      }
    } else {
      // Backend returned null — no matching memories (not a timeout)
      const missts = Date.now();
      console.log(`[memory] retrieve — no matching memories (${missts - start}ms)`);
      this._broadcast({ type: 'memory.miss', timestamp: missts });
      if (conversationId) {
        this._persist(conversationId, 'memory_miss', {}, missts);
        this._thoughtflowStep(conversationId, 'memory.retrieve', { source: 'miss', elapsed_ms: missts - start }, missts);
      }
    }
    return result;
  }

  private _kickBackgroundRefresh(backend: import('./types').MemoryBackend, query: string): void {
    if (this._inflightRetrieve) return; // already refreshing
    if (!query.trim()) return; // skip refresh with empty query — Mem0 rejects blank queries
    this._inflightRetrieve = backend.retrieve(query, 5)
      .then(result => {
        this._inflightRetrieve = null;
        if (result !== null) {
          this._cachedMemories = result;
          this._cachedQuery = query;
          this._cacheUpdatedAt = Date.now();
          console.log(`[memory] retrieve — cache refreshed (${result.split('\n').length} result(s))`);
        }
        return result;
      })
      .catch(e => {
        this._inflightRetrieve = null;
        console.warn('[memory] background refresh error:', e?.message || e);
        return null;
      });
  }

  /** Background extraction + storage — runs once on conversation end, never throws */
  private async _extractAndStore(conv: import('./types').CompletedConversation): Promise<void> {
    const backend = getMemoryBackend();
    if (!backend.available) return;

    const client = this.openaiClient;
    if (!client) return;

    const config = getMemoryConfig();
    console.log(`[memory] extractAndStore — channel: ${conv.channel} conv: ${conv.conversationId} turns: ${conv.turns.length}`);

    // Format full transcript
    const transcript = conv.turns
      .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`)
      .join('\n');

    try {
      const response = await client.chat.completions.create({
        model: config.extraction_model,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: transcript },
        ],
        max_completion_tokens: 300,
        temperature: 0,
      });
      const text: string = response.choices?.[0]?.message?.content?.trim() || '';
      if (!text || text === 'NONE' || text.startsWith('NONE')) {
        console.log('[memory] extraction — nothing worth storing');
        return;
      }
      console.log(`[memory] extraction — storing facts:\n${text}`);
      await backend.add(text, { channel: conv.channel, conversation_id: conv.conversationId });
      console.log('[memory] extraction — stored successfully');
      const storedts = Date.now();
      this._broadcast({ type: 'memory.stored', facts: text, channel: conv.channel, timestamp: storedts });
      this._persist(conv.conversationId, 'memory_stored', { facts: text, channel: conv.channel }, storedts);
      this._thoughtflowStep(conv.conversationId, 'memory.store', { channel: conv.channel, facts_length: text.length }, storedts);
      // Invalidate cache so next retrieve gets fresh data
      this._cachedMemories = null;
    } catch (e: any) {
      console.warn('[memory] extraction error:', e?.message || e);
    }
  }
  /**
   * Retrieve memories with deduplication applied.
   *
   * Returns the recall result (all context + novel-only items). If the backend
   * times out and an `onLateArrival` callback is provided, the memory module
   * will invoke it when the fetch completes — callers supply their
   * channel-specific reaction (e.g. shadow turn) without needing to manage
   * the late-promise themselves.
   */
  async retrieveWithLate(query: string, opts?: {
    timeoutMs?: number;
    conversationId?: string;
    /** Recent conversation turns for building a context-enriched retrieval query. */
    conversationHistory?: ContextTurn[];
    /** Called when memories arrive after the initial timeout. */
    onLateArrival?: (result: { memories: string | null; newMemories: string | null }) => void;
  }): Promise<{
    /** All memories (new + known) — for system-prompt context */
    memories: string | null;
    /** Only items not previously surfaced — for deciding whether to interrupt */
    newMemories: string | null;
  }> {
    const { timeoutMs, conversationId, conversationHistory, onLateArrival } = opts ?? {};

    // Sync dedup config from runtime config before each lookup
    const cfg = getMemoryConfig();
    this._dedup.configure({
      enabled: cfg.dedup_enabled,
      expiryTurns: cfg.dedup_expiry_turns,
      expiryMs: cfg.dedup_expiry_ms,
      strictness: cfg.dedup_strictness,
    });
    this._dedup.advanceTurn();

    // Build context-enriched query from conversation history
    const enrichedQuery = buildContextQuery(
      query,
      conversationHistory,
      cfg.context_window_turns,
      cfg.context_window_max_chars
    );
    if (enrichedQuery !== query) {
      console.log(`[memory] context window — enriched query with ${conversationHistory?.length ?? 0} turns (${enrichedQuery.length} chars)`);
    }

    const rawMemories = await this.retrieve(enrichedQuery, timeoutMs, conversationId);

    if (rawMemories !== null) {
      const dedupResult = this._dedup.deduplicate(rawMemories);
      let memories = dedupResult.allItems.length > 0 ? formatMemoryItems(dedupResult.allItems) : null;
      let newMemories = dedupResult.newItems.length > 0 ? formatMemoryItems(dedupResult.newItems) : null;
      this._dedup.markSurfaced(dedupResult.newItems);
      this._persistDedupLog(dedupResult, conversationId);

      // Run arbitrator if enabled — filters out irrelevant memories
      if (cfg.arbitrator_enabled && memories) {
        const arbResult = await this._runArbitrator(memories, newMemories, query, conversationHistory, conversationId);
        memories = arbResult.memories;
        newMemories = arbResult.newMemories;
      }

      return { memories, newMemories };
    }

    // Timed out — wire up late-arrival callback if the fetch is still in-flight
    const inflightRef = this._inflightRetrieve;
    if (inflightRef && onLateArrival) {
      inflightRef.then(async lateRaw => {
        if (!lateRaw) return;
        const dedupResult = this._dedup.deduplicate(lateRaw);
        let memories = dedupResult.allItems.length > 0 ? formatMemoryItems(dedupResult.allItems) : null;
        let newMemories = dedupResult.newItems.length > 0 ? formatMemoryItems(dedupResult.newItems) : null;
        this._dedup.markSurfaced(dedupResult.newItems);
        this._persistDedupLog(dedupResult, conversationId);

        // Run arbitrator on late arrivals too
        if (cfg.arbitrator_enabled && memories) {
          const arbResult = await this._runArbitrator(memories, newMemories, query, conversationHistory, conversationId);
          memories = arbResult.memories;
          newMemories = arbResult.newMemories;
        }

        onLateArrival({ memories, newMemories });
      }).catch(e => console.warn('[memory] late-arrival callback error:', (e as any)?.message || e));
    }

    return { memories: null, newMemories: null };
  }

  /**
   * Run the arbitrator agent to filter irrelevant memories.
   * Returns filtered memories, falling back to unfiltered on error/timeout.
   */
  private async _runArbitrator(
    memories: string | null,
    newMemories: string | null,
    currentMessage: string,
    conversationHistory: ContextTurn[] | undefined,
    conversationId?: string
  ): Promise<{ memories: string | null; newMemories: string | null }> {
    if (!memories) return { memories, newMemories };

    const cfg = getMemoryConfig();
    const start = Date.now();
    try {
      const arbResult: ArbitratorResult = await filterMemoriesWithArbitrator({
        currentMessage,
        conversationHistory: conversationHistory ?? [],
        retrievedMemories: memories,
        model: cfg.arbitrator_model,
        timeoutMs: cfg.arbitrator_timeout_ms,
      });

      const elapsed = Date.now() - start;
      const { filtered, kept, removed, timedOut } = arbResult;
      const inputCount = kept.length + removed.length;
      const outputCount = kept.length;

      // Detailed console logging
      if (timedOut) {
        console.warn(`[memory] arbitrator timed out (${elapsed}ms), returning all ${inputCount} memories unfiltered`);
      } else {
        console.log(`[memory] arbitrator — kept ${outputCount}/${inputCount} memories (${elapsed}ms)`);
        if (kept.length > 0) {
          console.log(`[memory] arbitrator kept:\n${kept.map(l => `  ✓ ${l}`).join('\n')}`);
        }
        if (removed.length > 0) {
          console.log(`[memory] arbitrator removed:\n${removed.map(l => `  ✗ ${l}`).join('\n')}`);
        }
      }

      // UI breadcrumbs — include content so the frontend can display decisions
      const arbTs = Date.now();
      this._broadcast({
        type: 'memory.arbitrator',
        input_count: inputCount,
        output_count: outputCount,
        elapsed_ms: elapsed,
        timed_out: timedOut,
        kept,
        removed,
        timestamp: arbTs,
      });
      if (conversationId) {
        this._persist(conversationId, 'memory_arbitrator', {
          input_count: inputCount,
          output_count: outputCount,
          elapsed_ms: elapsed,
          timed_out: timedOut,
          kept,
          removed,
        }, arbTs);
        this._thoughtflowStep(conversationId, 'memory.arbitrator', {
          input_count: inputCount,
          output_count: outputCount,
          elapsed_ms: elapsed,
          timed_out: timedOut,
          kept,
          removed,
        }, arbTs);
      }

      if (!filtered || outputCount === 0) {
        return { memories: null, newMemories: null };
      }

      // Re-derive newMemories from the filtered set: keep only new items that survived filtering
      const filteredLines = new Set(filtered.split('\n').map(l => l.trim()).filter(Boolean));
      let filteredNew: string | null = null;
      if (newMemories) {
        const keptNewLines = newMemories.split('\n').filter(l => {
          const trimmed = l.trim();
          return trimmed && filteredLines.has(trimmed);
        });
        filteredNew = keptNewLines.length > 0 ? keptNewLines.join('\n') : null;
      }

      return { memories: filtered, newMemories: filteredNew };
    } catch (e: any) {
      const elapsed = Date.now() - start;
      console.warn(`[memory] arbitrator error (${elapsed}ms), falling back to unfiltered:`, e?.message || e);
      return { memories, newMemories };
    }
  }

  /**
   * Expose dedup metrics for observability / API consumers.
   */
  getDedupMetrics() {
    return this._dedup.getMetrics();
  }

  /**
   * Force immediate re-surfacing of all suppressed memories.
   * Call when the user explicitly requests memory recall.
   */
  clearDedupState(): void {
    this._dedup.clearAll();
  }

  /**
   * Clear in-memory cache so the next retrieval fetches fresh data from the backend.
   * Call on session reset or backend switch.
   */
  clearCache(): void {
    this._cachedMemories = null;
    this._cacheUpdatedAt = 0;
    this._dedup.reset();
  }

  private _persistDedupLog(
    result: import('./deduplicator').DeduplicationResult,
    conversationId?: string
  ): void {
    if (!conversationId) return;
    try {
      const ts = Date.now();
      addConversationEvent({
        conversation_id: conversationId,
        kind: 'memory_dedup',
        payload: {
          turn: this._dedup.currentTurn,
          total: result.allItems.length,
          new: result.newItems.length,
          known: result.knownItems.length,
          suppressed: result.suppressed,
          elapsed_ms: result.elapsedMs,
          log: result.log,
        },
        created_at_ms: ts,
      });
    } catch {}
  }
}

/** Singleton instance */
export const memoryModule = new MemoryModule();
