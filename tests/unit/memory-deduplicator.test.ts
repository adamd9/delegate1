/**
 * Unit tests for MemoryDeduplicator.
 *
 * Scenarios covered:
 *  1. Exact match — previously surfaced item suppressed
 *  2. Normalized match — case/punctuation differences still suppressed
 *  3. Version-change — extended item treated as new despite shared prefix
 *  4. Partial-delta — item already known, brand-new sibling item surfaced
 *  5. Expiry by turn count
 *  6. Expiry by elapsed time
 *  7. Collapse redundant items within a single batch
 *  8. clearAll() re-enables surfacing
 *  9. clearSuppressedItem() targeted re-surfacing
 * 10. Deduplication disabled (pass-through)
 * 11. Metrics tracking
 * 12. Reset clears turn counter and surfaced set
 */

import assert from 'assert';
import { MemoryDeduplicator, parseMemoryItems, formatMemoryItems } from '../../src/memory/deduplicator';

// ── helpers ──────────────────────────────────────────────────────────────────

function dedup(items: string[], config?: Parameters<MemoryDeduplicator['configure']>[0]) {
  const d = new MemoryDeduplicator(config);
  return d.deduplicate(formatMemoryItems(items));
}

function surfaceThenDedup(
  first: string[],
  second: string[],
  config?: Parameters<MemoryDeduplicator['configure']>[0]
) {
  const d = new MemoryDeduplicator(config);
  d.advanceTurn();
  const r1 = d.deduplicate(formatMemoryItems(first));
  d.markSurfaced(r1.newItems);
  d.advanceTurn();
  const r2 = d.deduplicate(formatMemoryItems(second));
  return { r1, r2, deduplicator: d };
}

// ── test 1: exact match suppression ──────────────────────────────────────────

function testExactMatch() {
  const item = '- Your name is Alice';
  const { r1, r2 } = surfaceThenDedup([item], [item], { strictness: 'exact' });

  assert.strictEqual(r1.newItems.length, 1, 'first lookup: item should be new');
  assert.strictEqual(r1.knownItems.length, 0, 'first lookup: no known items');
  assert.strictEqual(r2.newItems.length, 0, 'second lookup: item should be suppressed');
  assert.strictEqual(r2.knownItems.length, 1, 'second lookup: item should be in knownItems');
  assert.strictEqual(r2.suppressed, 1, 'second lookup: suppressed count = 1');
  assert.strictEqual(r2.log[0].status, 'known', 'second lookup: log status = known');
  console.log('✓ testExactMatch');
}

// ── test 2: normalized match suppression ─────────────────────────────────────

function testNormalizedMatch() {
  const first = '- Your name is Alice.';
  const second = '- your name is alice';  // different case + no punctuation

  const { r1, r2 } = surfaceThenDedup([first], [second], { strictness: 'normalized' });

  assert.strictEqual(r1.newItems.length, 1, 'first: item is new');
  assert.strictEqual(r2.newItems.length, 0, 'second: normalized match → suppressed');
  assert.strictEqual(r2.knownItems.length, 1, 'second: item in knownItems');
  assert.strictEqual(r2.log[0].status, 'known');
  console.log('✓ testNormalizedMatch');
}

// ── test 3: version-change (item extended) ────────────────────────────────────

function testVersionChange() {
  const original = '- Your name is Alice';
  const updated  = '- Your name is Alice and you work at Acme Corp';

  const { r1, r2 } = surfaceThenDedup([original], [updated], { strictness: 'normalized' });

  assert.strictEqual(r1.newItems.length, 1, 'first: original is new');
  assert.strictEqual(r2.newItems.length, 1, 'second: extended item should be treated as new');
  assert.strictEqual(r2.log[0].status, 'updated', 'second: log status = updated');
  console.log('✓ testVersionChange');
}

// ── test 4: partial-delta (mixed known + new) ─────────────────────────────────

function testPartialDelta() {
  const knownItem = '- Your name is Alice';
  const brandNew  = '- You prefer dark mode';

  const { r1, r2 } = surfaceThenDedup([knownItem], [knownItem, brandNew]);

  assert.strictEqual(r1.newItems.length, 1, 'first: one new item');
  assert.strictEqual(r2.newItems.length, 1, 'second: only brand-new item is new');
  assert.strictEqual(r2.knownItems.length, 1, 'second: previously surfaced item is known');
  assert.ok(r2.newItems[0].includes('dark mode'), 'second: new item is the dark-mode fact');
  console.log('✓ testPartialDelta');
}

// ── test 5: expiry by turn count ─────────────────────────────────────────────

function testExpiryByTurns() {
  const item = '- Your name is Alice';
  const d = new MemoryDeduplicator({ expiryTurns: 3, expiryMs: 999999 });

  d.advanceTurn(); // turn 1
  const r1 = d.deduplicate(formatMemoryItems([item]));
  d.markSurfaced(r1.newItems);

  // turns 2, 3, 4 — cross expiry threshold of 3 turns
  d.advanceTurn();
  d.advanceTurn();
  d.advanceTurn(); // turn 4 → age = 3 turns → expires

  const r2 = d.deduplicate(formatMemoryItems([item]));
  assert.strictEqual(r1.newItems.length, 1, 'first: item is new');
  assert.strictEqual(r2.newItems.length, 1, 'after expiry: item is new again');
  console.log('✓ testExpiryByTurns');
}

// ── test 6: expiry by elapsed time ───────────────────────────────────────────

async function testExpiryByTime() {
  const item = '- Your name is Alice';
  const d = new MemoryDeduplicator({ expiryTurns: 999, expiryMs: 50 }); // 50 ms TTL

  d.advanceTurn();
  const r1 = d.deduplicate(formatMemoryItems([item]));
  d.markSurfaced(r1.newItems);

  // Verify suppression BEFORE expiry
  d.advanceTurn();
  const rMid = d.deduplicate(formatMemoryItems([item]));
  assert.strictEqual(rMid.newItems.length, 0, 'mid: item still suppressed before TTL');

  // Wait for TTL to elapse
  await new Promise(resolve => setTimeout(resolve, 80));

  d.advanceTurn();
  const r2 = d.deduplicate(formatMemoryItems([item]));
  assert.strictEqual(r2.newItems.length, 1, 'after TTL: item is new again');
  console.log('✓ testExpiryByTime');
}

// ── test 7: collapse redundant within a batch ─────────────────────────────────

function testCollapseRedundant() {
  const shorter = '- Your name is Alice';
  const longer  = '- Your name is Alice and you work at Acme Corp';

  // Both arrive in the same lookup batch — the shorter one should be collapsed
  const result = dedup([shorter, longer]);

  assert.strictEqual(result.newItems.length, 1, 'only one representative item');
  assert.ok(result.newItems[0].includes('Acme Corp'), 'kept the longer (more complete) item');
  console.log('✓ testCollapseRedundant');
}

// ── test 8: clearAll re-enables surfacing ─────────────────────────────────────

function testClearAll() {
  const item = '- Your name is Alice';
  const d = new MemoryDeduplicator();

  d.advanceTurn();
  const r1 = d.deduplicate(formatMemoryItems([item]));
  d.markSurfaced(r1.newItems);

  d.advanceTurn();
  const rSuppressed = d.deduplicate(formatMemoryItems([item]));
  assert.strictEqual(rSuppressed.newItems.length, 0, 'item is suppressed before clearAll');

  d.clearAll();

  d.advanceTurn();
  const rResurfaced = d.deduplicate(formatMemoryItems([item]));
  assert.strictEqual(rResurfaced.newItems.length, 1, 'item is new again after clearAll');
  console.log('✓ testClearAll');
}

// ── test 9: targeted clearSuppressedItem ─────────────────────────────────────

function testClearSuppressedItem() {
  const item1 = '- Your name is Alice';
  const item2 = '- You prefer dark mode';
  const d = new MemoryDeduplicator();

  d.advanceTurn();
  const r1 = d.deduplicate(formatMemoryItems([item1, item2]));
  d.markSurfaced(r1.newItems);

  // Clear only item1
  const removed = d.clearSuppressedItem(item1);
  assert.ok(removed, 'clearSuppressedItem should return true when item found');

  d.advanceTurn();
  const r2 = d.deduplicate(formatMemoryItems([item1, item2]));
  assert.strictEqual(r2.newItems.length, 1, 'only the cleared item is new');
  assert.ok(r2.newItems[0].includes('Alice'), 'the re-surfaced item is Alice');
  assert.strictEqual(r2.knownItems.length, 1, 'dark-mode item stays suppressed');
  console.log('✓ testClearSuppressedItem');
}

// ── test 10: deduplication disabled ──────────────────────────────────────────

function testDisabled() {
  const item = '- Your name is Alice';
  const d = new MemoryDeduplicator({ enabled: false });

  d.advanceTurn();
  const r1 = d.deduplicate(formatMemoryItems([item]));
  d.markSurfaced(r1.newItems);

  d.advanceTurn();
  const r2 = d.deduplicate(formatMemoryItems([item]));
  assert.strictEqual(r2.newItems.length, 1, 'disabled: item always treated as new');
  assert.strictEqual(r2.suppressed, 0, 'disabled: no suppression');
  console.log('✓ testDisabled');
}

// ── test 11: metrics tracking ─────────────────────────────────────────────────

function testMetrics() {
  const item1 = '- Your name is Alice';
  const item2 = '- You prefer dark mode';
  const d = new MemoryDeduplicator();

  d.advanceTurn();
  const r1 = d.deduplicate(formatMemoryItems([item1, item2]));
  d.markSurfaced(r1.newItems);

  d.advanceTurn();
  d.deduplicate(formatMemoryItems([item1, item2])); // both suppressed

  const m = d.getMetrics();
  assert.strictEqual(m.lookupCount, 2, 'metrics: 2 lookups');
  assert.strictEqual(m.totalSurfaced, 2, 'metrics: 2 items surfaced');
  assert.strictEqual(m.totalSuppressed, 2, 'metrics: 2 items suppressed on second lookup');
  assert.strictEqual(m.totalInterruptions, 1, 'metrics: only 1 interrupt (first lookup)');
  assert.ok(m.avgLatencyMs >= 0, 'metrics: avg latency is non-negative');
  console.log('✓ testMetrics');
}

// ── test 12: reset clears state ───────────────────────────────────────────────

function testReset() {
  const item = '- Your name is Alice';
  const d = new MemoryDeduplicator();

  d.advanceTurn();
  const r1 = d.deduplicate(formatMemoryItems([item]));
  d.markSurfaced(r1.newItems);

  d.reset(); // simulates conversation end

  assert.strictEqual(d.currentTurn, 0, 'reset: turn counter zeroed');

  d.advanceTurn();
  const r2 = d.deduplicate(formatMemoryItems([item]));
  assert.strictEqual(r2.newItems.length, 1, 'reset: item is new again after reset');
  console.log('✓ testReset');
}

// ── test 13: helpers parseMemoryItems / formatMemoryItems ────────────────────

function testHelpers() {
  const items = ['- Alice', '- Bob', '- Charlie'];
  const formatted = formatMemoryItems(items);
  const parsed = parseMemoryItems(formatted);
  assert.deepStrictEqual(parsed, items, 'helpers: round-trip preserves items');
  assert.deepStrictEqual(parseMemoryItems(''), [], 'helpers: empty string → empty array');
  assert.deepStrictEqual(parseMemoryItems('  \n  \n  '), [], 'helpers: whitespace-only → empty array');
  console.log('✓ testHelpers');
}

// ── run all ───────────────────────────────────────────────────────────────────

async function runAll() {
  testExactMatch();
  testNormalizedMatch();
  testVersionChange();
  testPartialDelta();
  testExpiryByTurns();
  await testExpiryByTime();
  testCollapseRedundant();
  testClearAll();
  testClearSuppressedItem();
  testDisabled();
  testMetrics();
  testReset();
  testHelpers();
  console.log('\nmemory-deduplicator tests passed ✓');
}

runAll().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
