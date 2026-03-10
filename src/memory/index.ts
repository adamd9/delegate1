import { getMemoryBackend } from './backends';
import { conversationBus } from './conversationBus';
import { getMemoryConfig } from './memoryConfig';
import type { CompletedTurn } from './types';
import { createOpenAIClient } from '../services/openaiClient';
import { chatClients } from '../ws/clients';

const EXTRACTION_SYSTEM_PROMPT = `You extract durable, personal facts worth remembering from a conversation turn.
Return a plain-text bullet list of facts (one per line, starting with "-").
Only include facts that are specific, personal, and unlikely to change soon (e.g. preferences, names, locations, recurring patterns).
If there is nothing worth storing, return exactly: NONE`;

class MemoryModule {
  private _openaiClient: any = null;
  private _cachedMemories: string | null = null;
  private _cacheUpdatedAt: number = 0;
  private _inflightRetrieve: Promise<string | null> | null = null;

  constructor() {
    conversationBus.onTurnComplete((turn) => {
      this._extractAndStore(turn).catch(() => {});
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

  /**
   * Retrieve relevant memories.
   *
   * Stale-while-revalidate:
   * - If cache is warm, return it immediately (0ms) and kick off a background refresh.
   * - If cache is cold, race Mem0 against the timeout. If Mem0 wins, cache and return.
   *   If timeout wins, return null for this turn but let the Mem0 fetch continue running
   *   in the background so it populates the cache for the next turn.
   */
  async retrieve(query: string, timeoutMs?: number): Promise<string | null> {
    const backend = getMemoryBackend();
    if (!backend.available) return null;

    // Warm cache — return immediately, refresh in background
    if (this._cachedMemories !== null) {
      const ageMs = Date.now() - this._cacheUpdatedAt;
      const lines = this._cachedMemories.split('\n').filter(Boolean);
      console.log(`[memory] retrieve — cache hit (age: ${ageMs}ms), returning immediately`);
      this._broadcast({ type: 'memory.retrieved', count: lines.length, preview: this._cachedMemories.slice(0, 300), source: 'cache', age_ms: ageMs, timestamp: Date.now() });
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
              this._broadcast({ type: 'memory.retrieved', count: lines.length, preview: result.slice(0, 300), source: 'late', elapsed_ms: Date.now() - start, timestamp: Date.now() });
            } else {
              console.log(`[memory] retrieve — cache populated (${lines.length} result(s), will be used next turn)`);
            }
          } else {
            console.log('[memory] retrieve — Mem0 returned no results (cache stays cold)');
            if (timedOut) {
              this._broadcast({ type: 'memory.miss', timestamp: Date.now() });
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
      console.log(`[memory] retrieve — timed out after ${Date.now() - start}ms; fetch continues in background for next turn`);
      this._broadcast({ type: 'memory.pending', elapsed_ms: effectiveTimeout, timestamp: Date.now() });
    } else {
      const lines = result.split('\n').filter(Boolean);
      console.log(`[memory] retrieve — got ${lines.length} result(s) in ${Date.now() - start}ms`);
      this._broadcast({ type: 'memory.retrieved', count: lines.length, preview: result.slice(0, 300), source: 'fresh', elapsed_ms: Date.now() - start, timestamp: Date.now() });
    }
    return result;
  }

  private _kickBackgroundRefresh(backend: import('./types').MemoryBackend, query: string): void {
    if (this._inflightRetrieve) return; // already refreshing
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

  /** Background extraction + storage — fire and forget, never throws */
  private async _extractAndStore(turn: CompletedTurn): Promise<void> {
    const backend = getMemoryBackend();
    if (!backend.available) return;

    const client = this.openaiClient;
    if (!client) return;

    const config = getMemoryConfig();
    console.log(`[memory] extractAndStore — channel: ${turn.channel} conv: ${turn.conversationId}`);
    const userPrompt = `User: ${turn.userContent}\nAssistant: ${turn.assistantContent}`;

    try {
      const response = await client.chat.completions.create({
        model: config.extraction_model,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
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
      await backend.add(text, { channel: turn.channel, conversation_id: turn.conversationId });
      console.log('[memory] extraction — stored successfully');
      this._broadcast({ type: 'memory.stored', facts: text, channel: turn.channel, timestamp: Date.now() });
      // Invalidate cache so next retrieve gets fresh data
      this._cachedMemories = null;
    } catch (e: any) {
      console.warn('[memory] extraction error:', e?.message || e);
    }
  }
  /**
   * Like retrieve() but also returns the still-running Mem0 promise if we timed out,
   * so callers can schedule a shadow turn when memories arrive late.
   */
  async retrieveWithLate(query: string, timeoutMs?: number): Promise<{
    memories: string | null;
    latePromise: Promise<string | null> | null;
  }> {
    const memories = await this.retrieve(query, timeoutMs);
    if (memories !== null) return { memories, latePromise: null };
    // Timed out (or empty query / no backend) — capture any still-running fetch
    const latePromise = this._inflightRetrieve; // still set when we raced and lost
    return { memories: null, latePromise };
  }}

/** Singleton instance */
export const memoryModule = new MemoryModule();
