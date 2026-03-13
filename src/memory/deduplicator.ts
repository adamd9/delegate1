/**
 * Memory deduplication — prevents redundant memory items from causing
 * unnecessary interruptions during active conversation turns.
 *
 * Behaviour:
 * - Items previously surfaced in the current conversation are treated as
 *   "known" and are excluded from the "new" set that drives interruptions
 *   (e.g. shadow turns).
 * - Known items are still included in the "all" set so the agent retains
 *   full context.
 * - Items that have been updated (the new text contains the old text as a
 *   proper sub-string) are always treated as new, even if they share a
 *   normalised prefix.
 * - Multiple candidates that are strict subsets of each other are collapsed
 *   so only the most complete version is surfaced.
 * - Surfaced items expire after a configurable number of turns or elapsed
 *   wall-clock time, making them eligible for re-surfacing.
 * - Callers can force immediate re-surfacing via clearAll() / clearSuppressedItem().
 * - All decisions are logged; metrics are tracked for observability.
 */

export interface SurfacedItem {
  normalizedText: string;
  originalText: string;
  turnNumber: number;
  surfacedAt: number; // Unix ms
}

export interface DeduplicationLogEntry {
  item: string;
  status: 'new' | 'known' | 'updated';
  matchedAgainst?: string;
  reason: string;
}

export interface DeduplicationResult {
  /** All items (new first, then known) — safe to use as full context */
  allItems: string[];
  /** Items not previously surfaced — use to decide whether to interrupt */
  newItems: string[];
  /** Items already surfaced — include as background context only */
  knownItems: string[];
  /** How many items were suppressed from the interrupt set */
  suppressed: number;
  /** Wall-clock time spent in deduplicate() (ms) */
  elapsedMs: number;
  /** Detailed decision log for debugging / threshold tuning */
  log: DeduplicationLogEntry[];
}

export interface DeduplicationMetrics {
  /** Times a shadow-turn-eligible result was produced (new items found) */
  totalInterruptions: number;
  /** Total items suppressed from interrupt set across all lookups */
  totalSuppressed: number;
  /** Total items treated as new across all lookups */
  totalSurfaced: number;
  /** Total deduplicate() calls */
  lookupCount: number;
  /** Running average of deduplicate() latency (ms) */
  avgLatencyMs: number;
  /** Sum of all deduplicate() latencies (ms) */
  totalLatencyMs: number;
  /**
   * Approximate false-suppression count: cases where an item was treated as
   * "known" but its text had grown (version-change caught by updated path).
   * True false-suppression rate requires external user-satisfaction feedback.
   */
  versionChanges: number;
}

export type DeduplicationStrictness = 'exact' | 'normalized';

export interface DeduplicationConfig {
  /** When false the deduplicator is a transparent pass-through */
  enabled: boolean;
  /** Turns after which a surfaced item becomes eligible for re-surfacing */
  expiryTurns: number;
  /** Milliseconds after which a surfaced item becomes eligible for re-surfacing */
  expiryMs: number;
  /** 'exact' = compare trimmed raw strings; 'normalized' = case-fold + strip punctuation */
  strictness: DeduplicationStrictness;
}

const DEFAULT_CONFIG: DeduplicationConfig = {
  enabled: true,
  expiryTurns: 10,
  expiryMs: 30 * 60 * 1000, // 30 minutes
  strictness: 'normalized',
};

// ── helpers ─────────────────────────────────────────────────────────────────

/** Strip leading list markers and normalise whitespace / case / punctuation. */
function normalizeItem(text: string): string {
  return text
    .replace(/^[-•*]\s*/, '')       // strip leading list markers
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')       // replace non-word chars with space
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim();
}

/** Parse a multi-line memories string into individual item strings. */
export function parseMemoryItems(memoriesStr: string): string[] {
  return memoriesStr
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

/** Join individual items back into a memories string. */
export function formatMemoryItems(items: string[]): string {
  return items.join('\n');
}

// ── class ────────────────────────────────────────────────────────────────────

export class MemoryDeduplicator {
  private _surfaced: Map<string, SurfacedItem> = new Map();
  private _currentTurn = 0;
  private _config: DeduplicationConfig;
  private _metrics: DeduplicationMetrics = {
    totalInterruptions: 0,
    totalSuppressed: 0,
    totalSurfaced: 0,
    lookupCount: 0,
    avgLatencyMs: 0,
    totalLatencyMs: 0,
    versionChanges: 0,
  };

  constructor(config?: Partial<DeduplicationConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── configuration ──────────────────────────────────────────────────────────

  configure(updates: Partial<DeduplicationConfig>): void {
    this._config = { ...this._config, ...updates };
  }

  getConfig(): DeduplicationConfig {
    return { ...this._config };
  }

  // ── turn lifecycle ─────────────────────────────────────────────────────────

  /** Call once per incoming user turn before deduplicate(). */
  advanceTurn(): void {
    this._currentTurn++;
  }

  get currentTurn(): number {
    return this._currentTurn;
  }

  // ── core logic ─────────────────────────────────────────────────────────────

  /**
   * Classify a raw memories string into new vs. known items.
   *
   * @param rawMemories  - the full memories string returned by the backend.
   * @returns a DeduplicationResult; call markSurfaced(result.newItems) afterwards.
   */
  deduplicate(rawMemories: string | null): DeduplicationResult {
    const start = Date.now();
    this._metrics.lookupCount++;

    if (!rawMemories || !this._config.enabled) {
      const items = rawMemories ? parseMemoryItems(rawMemories) : [];
      const elapsed = Date.now() - start;
      this._updateLatency(elapsed);
      if (items.length > 0) this._metrics.totalInterruptions++;
      this._metrics.totalSurfaced += items.length;
      return {
        allItems: items,
        newItems: items,
        knownItems: [],
        suppressed: 0,
        elapsedMs: elapsed,
        log: items.map(item => ({ item, status: 'new' as const, reason: 'deduplication disabled' })),
      };
    }

    this._clearExpired();

    const items = parseMemoryItems(rawMemories);
    const newItems: string[] = [];
    const knownItems: string[] = [];
    const log: DeduplicationLogEntry[] = [];

    for (const item of items) {
      const normalized = this._normalize(item);
      // First try exact key match, then try prefix-subset scan for version-changes
      const existing = this._surfaced.get(normalized) ?? this._findSubsumedBy(normalized);

      if (existing) {
        // Check for version-change: new item is longer and contains the stored item text
        if (normalized !== existing.normalizedText && normalized.includes(existing.normalizedText)) {
          newItems.push(item);
          this._metrics.versionChanges++;
          log.push({
            item,
            status: 'updated',
            matchedAgainst: existing.originalText,
            reason: `item extends previously surfaced item (turn ${existing.turnNumber})`,
          });
        } else {
          knownItems.push(item);
          log.push({
            item,
            status: 'known',
            matchedAgainst: existing.originalText,
            reason: `${this._config.strictness} match with previously surfaced item (turn ${existing.turnNumber})`,
          });
        }
      } else {
        newItems.push(item);
        log.push({
          item,
          status: 'new',
          reason: 'not previously surfaced in this conversation',
        });
      }
    }

    // Collapse within-batch redundancies (subset items superseded by a longer sibling)
    const deduplicatedNew = this._collapseRedundant(newItems);
    const suppressed = knownItems.length + (newItems.length - deduplicatedNew.length);

    this._metrics.totalSuppressed += suppressed;
    this._metrics.totalSurfaced += deduplicatedNew.length;
    if (deduplicatedNew.length > 0) this._metrics.totalInterruptions++;

    const elapsed = Date.now() - start;
    this._updateLatency(elapsed);

    // ── structured logging ──────────────────────────────────────────────────
    console.log(
      `[memory:dedup] turn=${this._currentTurn} total=${items.length} ` +
      `new=${deduplicatedNew.length} known=${knownItems.length} ` +
      `suppressed=${suppressed} elapsed=${elapsed}ms`
    );
    for (const entry of log) {
      console.log(
        `[memory:dedup]   ${entry.status.padEnd(7)} "${entry.item.slice(0, 80)}"` +
        (entry.matchedAgainst ? ` ← "${entry.matchedAgainst.slice(0, 60)}"` : '') +
        ` | ${entry.reason}`
      );
    }

    return {
      allItems: [...deduplicatedNew, ...knownItems],
      newItems: deduplicatedNew,
      knownItems,
      suppressed,
      elapsedMs: elapsed,
      log,
    };
  }

  /**
   * Record items as having been surfaced (shown to the agent/user).
   * Call this after incorporating `result.newItems` into the response pipeline.
   */
  markSurfaced(items: string[]): void {
    for (const item of items) {
      const normalized = this._normalize(item);
      this._surfaced.set(normalized, {
        normalizedText: normalized,
        originalText: item,
        turnNumber: this._currentTurn,
        surfacedAt: Date.now(),
      });
    }
  }

  // ── explicit re-surfacing ──────────────────────────────────────────────────

  /**
   * Remove a specific item from the surfaced set so it can be re-surfaced.
   * Pass the original or normalised text.
   * @returns true if the item was found and removed.
   */
  clearSuppressedItem(text: string): boolean {
    const normalized = this._normalize(text);
    return this._surfaced.delete(normalized);
  }

  /**
   * Clear the entire surfaced set.
   * Use when the user explicitly requests re-surfacing of all suppressed memories.
   */
  clearAll(): void {
    this._surfaced.clear();
    console.log('[memory:dedup] cleared all surfaced items — full re-surfacing enabled');
  }

  /**
   * Reset state for a new conversation (clears surfaced items and turn counter).
   */
  reset(): void {
    this._surfaced.clear();
    this._currentTurn = 0;
    console.log('[memory:dedup] state reset for new conversation');
  }

  // ── metrics ────────────────────────────────────────────────────────────────

  getMetrics(): DeduplicationMetrics {
    return { ...this._metrics };
  }

  resetMetrics(): void {
    this._metrics = {
      totalInterruptions: 0,
      totalSuppressed: 0,
      totalSurfaced: 0,
      lookupCount: 0,
      avgLatencyMs: 0,
      totalLatencyMs: 0,
      versionChanges: 0,
    };
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private _normalize(text: string): string {
    return this._config.strictness === 'exact' ? text.trim() : normalizeItem(text);
  }

  /**
   * Scan the surfaced set for an item whose normalised text is a proper substring
   * of `normalized` (i.e. the incoming item is an extension / update of that item).
   */
  private _findSubsumedBy(normalized: string): SurfacedItem | undefined {
    for (const [key, item] of this._surfaced.entries()) {
      if (normalized.includes(key) && normalized.length > key.length) {
        return item;
      }
    }
    return undefined;
  }

  /** Remove expired items from the surfaced set. */
  private _clearExpired(): void {
    const now = Date.now();
    const { expiryTurns, expiryMs } = this._config;
    let expiredCount = 0;
    for (const [key, item] of this._surfaced.entries()) {
      if (
        (this._currentTurn - item.turnNumber) >= expiryTurns ||
        (now - item.surfacedAt) >= expiryMs
      ) {
        this._surfaced.delete(key);
        expiredCount++;
      }
    }
    if (expiredCount > 0) {
      console.log(`[memory:dedup] expired ${expiredCount} item(s) from surfaced set`);
    }
  }

  /**
   * Within a batch of new items, collapse any item that is a strict subset of
   * another item in the same batch. Only the most-complete version is kept.
   */
  private _collapseRedundant(items: string[]): string[] {
    if (items.length <= 1) return items;
    const tagged = items.map(original => ({ original, norm: this._normalize(original) }));
    const result: string[] = [];
    for (let i = 0; i < tagged.length; i++) {
      const item = tagged[i];
      const superseded = tagged.some(
        (other, j) =>
          i !== j &&
          other.norm.includes(item.norm) &&
          other.norm.length > item.norm.length
      );
      if (superseded) {
        console.log(`[memory:dedup] collapsed redundant item: "${item.original.slice(0, 80)}"`);
      } else {
        result.push(item.original);
      }
    }
    return result;
  }

  private _updateLatency(elapsed: number): void {
    this._metrics.totalLatencyMs += elapsed;
    this._metrics.avgLatencyMs =
      this._metrics.lookupCount > 0
        ? this._metrics.totalLatencyMs / this._metrics.lookupCount
        : 0;
  }
}
