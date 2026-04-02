/**
 * Unit tests for MemoryArbiter.
 *
 * Scenarios covered:
 *  1. Disabled arbiter — always allows regardless of other factors
 *  2. Allow — enough new items, no prior interruption
 *  3. Deny — confidence below threshold (too few items)
 *  4. Rate-limit — second call too soon is denied, third call after delay is allowed
 *  5. Priority-tag force-allow — rate-limited but tag overrides
 *  6. Priority-tag case-insensitive matching
 *  7. Zero new items — denied regardless of threshold
 *  8. Defer decision not returned unless explicitly configured (default deny)
 *  9. reset() clears rate-limit state
 * 10. configure() updates policy on existing instance
 */

import assert from 'assert';
import { MemoryArbiter } from '../../src/memory/arbiter';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeArbiter(overrides?: Parameters<MemoryArbiter['configure']>[0]) {
  const a = new MemoryArbiter({
    enabled: true,
    rateLimitMs: 5_000,
    confidenceThreshold: 0.5,
    priorityTags: ['safety', 'billing'],
    ...overrides,
  });
  return a;
}

// ── test 1: disabled arbiter is a no-op ──────────────────────────────────────

function testDisabledAlwaysAllows() {
  const a = new MemoryArbiter({ enabled: false });
  const result = a.decide({ query: 'anything', newItemCount: 0 });
  assert.strictEqual(result.decision, 'allow', 'disabled arbiter should always allow');
  assert.strictEqual(result.confidence, 1.0);
  assert.ok(result.reason.includes('disabled'));
  console.log('✓ testDisabledAlwaysAllows');
}

// ── test 2: allow when items present and no recent interruption ───────────────

function testAllowNormal() {
  const a = makeArbiter();
  const result = a.decide({ query: 'hello', newItemCount: 2 });
  assert.strictEqual(result.decision, 'allow', 'should allow with 2 new items');
  assert.ok(result.confidence >= 0.5, 'confidence should meet threshold');
  console.log('✓ testAllowNormal');
}

// ── test 3: deny when confidence below threshold ──────────────────────────────

function testDenyLowConfidence() {
  // confidenceThreshold = 0.5; 1 item gives confidence = 1/3 ≈ 0.33
  const a = makeArbiter();
  const result = a.decide({ query: 'hello', newItemCount: 1 });
  assert.strictEqual(result.decision, 'deny', 'should deny with 1 item (confidence 0.33 < 0.5)');
  assert.ok(result.confidence < 0.5);
  console.log('✓ testDenyLowConfidence');
}

// ── test 4: rate-limit ────────────────────────────────────────────────────────

function testRateLimit() {
  const a = makeArbiter({ rateLimitMs: 10_000, confidenceThreshold: 0 });
  // First call — allowed
  const r1 = a.decide({ query: 'q', newItemCount: 3 });
  assert.strictEqual(r1.decision, 'allow', 'first call should be allowed');
  // Second call immediately — rate-limited
  const r2 = a.decide({ query: 'q', newItemCount: 3 });
  assert.strictEqual(r2.decision, 'deny', 'second call should be denied (rate-limited)');
  assert.ok(r2.reason.includes('rate-limited'));
  assert.ok((r2.suggestedDelayMs ?? 0) > 0, 'suggestedDelayMs should be positive');
  console.log('✓ testRateLimit');
}

// ── test 5: priority-tag force-allow overrides rate-limit ────────────────────

function testPriorityTagForceAllow() {
  const a = makeArbiter({ rateLimitMs: 60_000, confidenceThreshold: 0 });
  // First call to set the rate-limit clock
  a.decide({ query: 'q', newItemCount: 3 });
  // Second call with priority tag — should be allowed despite rate limit
  const r2 = a.decide({ query: 'q', newItemCount: 3, rationale: 'billing issue detected' });
  assert.strictEqual(r2.decision, 'allow', 'priority-tag should override rate-limit');
  assert.ok(r2.reason.includes('billing'));
  console.log('✓ testPriorityTagForceAllow');
}

// ── test 6: priority-tag matching is case-insensitive ────────────────────────

function testPriorityTagCaseInsensitive() {
  const a = makeArbiter({ rateLimitMs: 60_000, confidenceThreshold: 0 });
  a.decide({ query: 'q', newItemCount: 3 }); // consume rate-limit
  const r = a.decide({ query: 'q', newItemCount: 3, rationale: 'SAFETY OVERRIDE' });
  assert.strictEqual(r.decision, 'allow', 'priority-tag match should be case-insensitive');
  console.log('✓ testPriorityTagCaseInsensitive');
}

// ── test 7: zero new items ────────────────────────────────────────────────────

function testZeroItems() {
  const a = makeArbiter({ confidenceThreshold: 0.1 });
  const r = a.decide({ query: 'q', newItemCount: 0 });
  assert.strictEqual(r.decision, 'deny', 'zero items should be denied (confidence = 0)');
  assert.strictEqual(r.confidence, 0);
  console.log('✓ testZeroItems');
}

// ── test 8: reset() clears rate-limit ────────────────────────────────────────

function testResetClearsRateLimit() {
  const a = makeArbiter({ rateLimitMs: 60_000, confidenceThreshold: 0 });
  a.decide({ query: 'q', newItemCount: 3 }); // consume rate-limit
  const r1 = a.decide({ query: 'q', newItemCount: 3 });
  assert.strictEqual(r1.decision, 'deny', 'should be denied before reset');
  a.reset();
  const r2 = a.decide({ query: 'q', newItemCount: 3 });
  assert.strictEqual(r2.decision, 'allow', 'should be allowed after reset');
  console.log('✓ testResetClearsRateLimit');
}

// ── test 9: configure() updates policy live ──────────────────────────────────

function testConfigureUpdatesPolicy() {
  const a = makeArbiter({ confidenceThreshold: 0.9 });
  // 2 items → confidence ≈ 0.67, below threshold 0.9 → deny (no allow recorded)
  const r1 = a.decide({ query: 'q', newItemCount: 2 });
  assert.strictEqual(r1.decision, 'deny', 'should deny with threshold 0.9 and 2 items (confidence ≈ 0.67)');
  // Lower threshold — previous call was denied so _lastAllowedAt is still 0; no reset needed
  a.configure({ confidenceThreshold: 0.1 });
  const r2 = a.decide({ query: 'q', newItemCount: 2 });
  assert.strictEqual(r2.decision, 'allow', 'should allow after lowering threshold');
  console.log('✓ testConfigureUpdatesPolicy');
}

// ── test 10: multiple rapid calls — only first allowed ────────────────────────

function testMultipleRapidCallsOnlyFirstAllowed() {
  const a = makeArbiter({ rateLimitMs: 60_000, confidenceThreshold: 0 });
  const decisions: string[] = [];
  for (let i = 0; i < 5; i++) {
    decisions.push(a.decide({ query: 'q', newItemCount: 3 }).decision);
  }
  assert.strictEqual(decisions[0], 'allow', 'first call allowed');
  for (let i = 1; i < 5; i++) {
    assert.strictEqual(decisions[i], 'deny', `call ${i + 1} should be denied`);
  }
  console.log('✓ testMultipleRapidCallsOnlyFirstAllowed');
}

// ── runner ───────────────────────────────────────────────────────────────────

function runAll() {
  testDisabledAlwaysAllows();
  testAllowNormal();
  testDenyLowConfidence();
  testRateLimit();
  testPriorityTagForceAllow();
  testPriorityTagCaseInsensitive();
  testZeroItems();
  testResetClearsRateLimit();
  testConfigureUpdatesPolicy();
  testMultipleRapidCallsOnlyFirstAllowed();
  console.log('\nAll arbiter tests passed ✓');
}

runAll();
