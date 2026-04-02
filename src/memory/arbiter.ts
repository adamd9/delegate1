/**
 * Memory Retrieval Arbiter
 *
 * Decides whether a proposed memory retrieval should interrupt the current
 * conversation (allow), be silently suppressed (deny), or be deferred to a
 * later point (defer).
 *
 * Policies applied in order (first match wins):
 * 1. If disabled — always allow (transparent pass-through).
 * 2. Priority-tag force-allow — allow immediately if the proposal rationale
 *    contains any configured priority tag.
 * 3. Rate-limit — deny if the previous allowed interruption was too recent.
 * 4. Confidence threshold — deny if the computed confidence is below the
 *    configured minimum.
 * 5. Default — allow.
 *
 * The arbiter is intentionally stateless except for the rate-limit timestamp,
 * which is managed internally.  All other policy parameters are supplied via
 * ArbiterConfig.
 */

export type ArbiterDecision = 'allow' | 'deny' | 'defer';

export interface ArbiterResult {
  /** Whether to proceed with the interruption, skip it, or wait. */
  decision: ArbiterDecision;
  /** Confidence in the decision, 0..1 */
  confidence: number;
  /** Short human-readable reason (logged; never includes retrieved content) */
  reason: string;
  /** Only present when decision === 'defer'; milliseconds to wait */
  suggestedDelayMs?: number;
}

export interface RetrievalProposal {
  /** The query string that drove the retrieval. */
  query: string;
  /** Number of new (novel) memory items returned by the backend. */
  newItemCount: number;
  /**
   * Optional free-text rationale / tags attached by the caller.
   * The arbiter checks this for priority tags to force-allow.
   */
  rationale?: string;
}

export interface ArbiterConfig {
  /** When false the arbiter is a no-op and always allows. */
  enabled: boolean;
  /**
   * Minimum milliseconds between two allowed interruptions.
   * Set to 0 to disable rate-limiting.
   */
  rateLimitMs: number;
  /**
   * Minimum confidence score [0..1] required to allow an interruption.
   * Proposals scoring below this are denied.
   */
  confidenceThreshold: number;
  /**
   * Keywords that force an allow regardless of other policies.
   * Compared case-insensitively against the proposal's `rationale` field.
   */
  priorityTags: string[];
}

export const DEFAULT_ARBITER_CONFIG: ArbiterConfig = {
  enabled: false,         // off by default (feature-flag)
  rateLimitMs: 30_000,    // 30 seconds between interruptions
  confidenceThreshold: 0.5,
  priorityTags: ['safety', 'billing', 'urgent', 'critical'],
};

/**
 * Compute a simple confidence score for a retrieval proposal.
 * Returns a value in [0, 1].  Confidence grows with the number of new items
 * (plateaus at 3+ items) and is 0 when there are no new items.
 */
function computeConfidence(proposal: RetrievalProposal): number {
  if (proposal.newItemCount <= 0) return 0;
  return Math.min(1.0, proposal.newItemCount / 3.0);
}

export class MemoryArbiter {
  private _config: ArbiterConfig;
  private _lastAllowedAt = 0;

  constructor(config?: Partial<ArbiterConfig>) {
    this._config = { ...DEFAULT_ARBITER_CONFIG, ...(config ?? {}) };
  }

  configure(updates: Partial<ArbiterConfig>): void {
    this._config = { ...this._config, ...updates };
  }

  getConfig(): ArbiterConfig {
    return { ...this._config };
  }

  /**
   * Evaluate whether a retrieval proposal should interrupt the conversation.
   *
   * @param proposal  Metadata describing the proposed retrieval.
   * @returns An ArbiterResult with a decision, confidence score, and reason.
   */
  decide(proposal: RetrievalProposal): ArbiterResult {
    // Feature flag — transparent pass-through
    if (!this._config.enabled) {
      return { decision: 'allow', confidence: 1.0, reason: 'arbiter disabled' };
    }

    const confidence = computeConfidence(proposal);

    // Policy 1: Priority-tag force-allow
    if (proposal.rationale && this._config.priorityTags.length > 0) {
      const rationaleLC = proposal.rationale.toLowerCase();
      for (const tag of this._config.priorityTags) {
        if (rationaleLC.includes(tag.toLowerCase())) {
          this._lastAllowedAt = Date.now();
          return {
            decision: 'allow',
            confidence: 1.0,
            reason: `priority tag "${tag}" matched`,
          };
        }
      }
    }

    // Policy 2: Rate-limit
    if (this._config.rateLimitMs > 0 && this._lastAllowedAt > 0) {
      const elapsed = Date.now() - this._lastAllowedAt;
      if (elapsed < this._config.rateLimitMs) {
        const remaining = this._config.rateLimitMs - elapsed;
        return {
          decision: 'deny',
          confidence,
          reason: `rate-limited: ${elapsed}ms since last interruption (limit: ${this._config.rateLimitMs}ms)`,
          suggestedDelayMs: remaining,
        };
      }
    }

    // Policy 3: Confidence threshold
    if (confidence < this._config.confidenceThreshold) {
      return {
        decision: 'deny',
        confidence,
        reason: `confidence ${confidence.toFixed(2)} below threshold ${this._config.confidenceThreshold}`,
      };
    }

    // Default: allow
    this._lastAllowedAt = Date.now();
    return {
      decision: 'allow',
      confidence,
      reason: `${proposal.newItemCount} new item(s), confidence ${confidence.toFixed(2)}`,
    };
  }

  /** Reset rate-limit state (e.g. on session reset). */
  reset(): void {
    this._lastAllowedAt = 0;
  }
}
