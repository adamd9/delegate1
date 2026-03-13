import { getMemoryBackend } from './backends';
import { conversationBus } from './conversationBus';
import { getMemoryConfig } from './memoryConfig';
import type {} from './types'; // CompletedConversation used via namespace import below
import { createOpenAIClient } from '../services/openaiClient';
import { chatClients } from '../ws/clients';
import { addConversationEvent } from '../db/sqlite';
import { appendEvent, ensureSession } from '../observability/thoughtflow';
import { MemoryDeduplicator, formatMemoryItems } from './deduplicator';

const EXTRACTION_SYSTEM_PROMPT = `You extract durable personal facts about the USER from a completed conversation.

Rules:
- Only extract facts explicitly stated or clearly confirmed by the USER, not inferred or suggested by the assistant.
- Only include facts that are stable and long-lived: name, location, profession, relationships, firm preferences, accessibility needs, recurring patterns.
- DO NOT store: transient discussion topics, questions the assistant asked, options the assistant offered, facts the assistant assumed, speculative or unconfirmed details.
- Each fact must be a single plain-text line starting with "- ".
- If there are no qualifying facts, return exactly: NONE`;

class MemoryModule {
  private _openaiClient: any = null;
  private _cachedMemories: string | null = null;
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

    // Warm cache — return immediately, refresh in background
    if (this._cachedMemories !== null) {
      const ageMs = Date.now() - this._cacheUpdatedAt;
      const lines = this._cachedMemories.split('\n').filter(Boolean);
      console.log(`[memory] retrieve — cache hit (age: ${ageMs}ms), returning immediately`);
      const cachets = Date.now();
      this._broadcast({ type: 'memory.retrieved', count: lines.length, memories: this._cachedMemories, source: 'cache', age_ms: ageMs, timestamp: cachets });
      if (conversationId) {
        this._persist(conversationId, 'memory_retrieved', { source: 'cache', count: lines.length, age_ms: ageMs }, cachets);
        this._thoughtflowStep(conversationId, 'memory.retrieve', { source: 'cache', count: lines.length }, cachets);
      }
      this._kickBackgroundRefresh(backend, query);
      return this._cachedMemories;
    }

    if (!query.trim()) return null;

    const effectiveTimeout = timeoutMs ?? getMemoryConfig().retrieve_timeout_ms;
    console.log(`[memory] retrieve — cold cache, query: "${query.slice(0, 80)}${query.length > 80 ? '…' : ''}" timeout: ${effectiveTimeout}ms`);

    const start = Date.now();

    // Start (or reuse) the in-flight Mem0 fetch; it always runs to completion so it can populate the cache
    let timedOut = false;
    if (!this._inflightRetrieve) {
      this._inflightRetrieve = backend.retrieve(query, 5)
        .then(result => {
          this._inflightRetrieve = null;
          if (result !== null) {
            this._cachedMemories = result;
            this._cacheUpdatedAt = Date.now();
            const lines = result.split('\n').filter(Boolean);
            if (timedOut) {
              // Response already sent — let the user know memory is primed for next turn
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
            console.log('[memory] retrieve — Mem0 returned no results (cache stays cold)');
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
          console.warn('[memory] retrieve — Mem0 fetch error:', e?.message || e);
          return null;
        });
    }

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), effectiveTimeout)
    );

    const result = await Promise.race([this._inflightRetrieve, timeoutPromise]);
    if (result === null) {
      timedOut = true;
      const pendingts = Date.now();
      console.log(`[memory] retrieve — timed out after ${pendingts - start}ms; fetch continues in background for next turn`);
      this._broadcast({ type: 'memory.pending', elapsed_ms: effectiveTimeout, timestamp: pendingts });
      if (conversationId) {
        this._persist(conversationId, 'memory_pending', { elapsed_ms: effectiveTimeout }, pendingts);
        this._thoughtflowStep(conversationId, 'memory.retrieve', { source: 'timeout', elapsed_ms: effectiveTimeout }, pendingts);
      }
    } else {
      const lines = result.split('\n').filter(Boolean);
      const freshts = Date.now();
      console.log(`[memory] retrieve — got ${lines.length} result(s) in ${freshts - start}ms`);
      this._broadcast({ type: 'memory.retrieved', count: lines.length, memories: result, source: 'fresh', elapsed_ms: freshts - start, timestamp: freshts });
      if (conversationId) {
        this._persist(conversationId, 'memory_retrieved', { source: 'fresh', count: lines.length, elapsed_ms: freshts - start }, freshts);
        this._thoughtflowStep(conversationId, 'memory.retrieve', { source: 'fresh', count: lines.length }, freshts);
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
        max_tokens: 300,
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
   * Like retrieve() but also:
   * - applies deduplication (new items vs. previously surfaced items)
   * - returns the still-running Mem0 promise if we timed out, so callers can
   *   schedule a shadow turn — but only when genuinely new items arrive.
   */
  async retrieveWithLate(query: string, timeoutMs?: number, conversationId?: string): Promise<{
    /** All memories (new + known) — for system-prompt context */
    memories: string | null;
    /** Only items not previously surfaced — use to decide whether to interrupt */
    newMemories: string | null;
    /** Resolves when late memories arrive; null when memories came on time */
    latePromise: Promise<{ memories: string | null; newMemories: string | null }> | null;
  }> {
    // Sync dedup config from runtime config before each lookup
    const cfg = getMemoryConfig();
    this._dedup.configure({
      enabled: cfg.dedup_enabled,
      expiryTurns: cfg.dedup_expiry_turns,
      expiryMs: cfg.dedup_expiry_ms,
      strictness: cfg.dedup_strictness,
    });
    this._dedup.advanceTurn();

    const rawMemories = await this.retrieve(query, timeoutMs, conversationId);

    if (rawMemories !== null) {
      const dedupResult = this._dedup.deduplicate(rawMemories);
      const memories = dedupResult.allItems.length > 0 ? formatMemoryItems(dedupResult.allItems) : null;
      const newMemories = dedupResult.newItems.length > 0 ? formatMemoryItems(dedupResult.newItems) : null;
      this._dedup.markSurfaced(dedupResult.newItems);
      this._persistDedupLog(dedupResult, conversationId);
      return { memories, newMemories, latePromise: null };
    }

    // Timed out — capture any still-running fetch and wrap with dedup
    const inflightRef = this._inflightRetrieve;
    if (!inflightRef) {
      return { memories: null, newMemories: null, latePromise: null };
    }

    const latePromise: Promise<{ memories: string | null; newMemories: string | null }> =
      inflightRef.then(lateRaw => {
        if (!lateRaw) return { memories: null, newMemories: null };
        const dedupResult = this._dedup.deduplicate(lateRaw);
        const memories = dedupResult.allItems.length > 0 ? formatMemoryItems(dedupResult.allItems) : null;
        const newMemories = dedupResult.newItems.length > 0 ? formatMemoryItems(dedupResult.newItems) : null;
        this._dedup.markSurfaced(dedupResult.newItems);
        this._persistDedupLog(dedupResult, conversationId);
        return { memories, newMemories };
      });

    return { memories: null, newMemories: null, latePromise };
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
