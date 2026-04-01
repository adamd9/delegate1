/**
 * Unit tests for buildMemoryQuery.
 *
 * Scenarios:
 *  1. Empty history — returns current message unchanged
 *  2. History without text items — returns current message unchanged
 *  3. Chat path — current message already last item in history (no duplication)
 *  4. Voice path — current message not in history (appended to context lines)
 *  5. Respects recentTurns limit
 *  6. Truncates long turn content to 200 chars
 *  7. Includes both user and assistant turns
 */

import assert from 'assert';
import { buildMemoryQuery } from '../../src/memory/index';

// ── test 1: empty history ────────────────────────────────────────────────────

function testEmptyHistory() {
  const result = buildMemoryQuery('hello world', []);
  assert.strictEqual(result, 'hello world', 'empty history: should return current message as-is');
}

// ── test 2: history without text items ──────────────────────────────────────

function testNoTextItems() {
  const history = [
    { type: 'note', content: 'some note' },
    { type: 'thoughtflow', content: undefined },
  ];
  const result = buildMemoryQuery('hello', history as any);
  assert.strictEqual(result, 'hello', 'non-text history: should return current message as-is');
}

// ── test 3: chat path — current message is last item ────────────────────────

function testChatPath() {
  const history = [
    { type: 'assistant', content: 'Hi there, how can I help?' },
    { type: 'user', content: 'What is the capital of France?' },
    { type: 'assistant', content: 'The capital of France is Paris.' },
    { type: 'user', content: 'What about Germany?' }, // ← current message already pushed
  ];
  const result = buildMemoryQuery('What about Germany?', history as any);
  assert.ok(result.includes('What about Germany?'), 'current message should be in result');
  // Should not appear twice
  const occurrences = result.split('What about Germany?').length - 1;
  assert.strictEqual(occurrences, 1, 'current message should not be duplicated in chat path');
}

// ── test 4: voice path — current message not in history ─────────────────────

function testVoicePath() {
  const history = [
    { type: 'assistant', content: 'Hi there, how can I help?' },
    { type: 'user', content: 'What is the capital of France?' },
    { type: 'assistant', content: 'The capital of France is Paris.' },
  ];
  const transcript = 'What about Germany?';
  const result = buildMemoryQuery(transcript, history as any);
  assert.ok(result.includes('What about Germany?'), 'current transcript should be appended');
  assert.ok(result.includes('Paris'), 'previous context should be included');
}

// ── test 5: recentTurns limit ────────────────────────────────────────────────

function testRecentTurnsLimit() {
  const history = [
    { type: 'user', content: 'turn 1' },
    { type: 'assistant', content: 'response 1' },
    { type: 'user', content: 'turn 2' },
    { type: 'assistant', content: 'response 2' },
    { type: 'user', content: 'turn 3' },
    { type: 'assistant', content: 'response 3' },
    { type: 'user', content: 'turn 4' }, // current
  ];
  // recentTurns=2 means we include slice(-(2+1))=slice(-3) = last 3 items
  const result = buildMemoryQuery('turn 4', history as any, 2);
  assert.ok(!result.includes('turn 1'), 'turn 1 should be excluded by limit');
  assert.ok(!result.includes('turn 2'), 'turn 2 should be excluded by limit');
  assert.ok(result.includes('turn 3'), 'recent context should be included');
  assert.ok(result.includes('turn 4'), 'current message should be included');
}

// ── test 6: long content truncated to 200 chars ──────────────────────────────

function testTruncation() {
  const longContent = 'x'.repeat(300);
  const history = [
    { type: 'user', content: longContent },
    { type: 'user', content: 'short message' }, // current
  ];
  const result = buildMemoryQuery('short message', history as any);
  const lines = result.split('\n');
  const longLine = lines.find(l => l.includes('x'));
  assert.ok(longLine, 'long content line should exist');
  // "user: " prefix (6 chars) + 200 chars of content = 206 chars
  assert.ok(longLine!.length <= 206, `long content should be truncated: got ${longLine!.length}`);
}

// ── test 7: both roles formatted correctly ───────────────────────────────────

function testRoleLabels() {
  const history = [
    { type: 'user', content: 'user message' },
    { type: 'assistant', content: 'assistant response' },
    { type: 'user', content: 'follow up' }, // current
  ];
  const result = buildMemoryQuery('follow up', history as any);
  assert.ok(result.includes('user: user message'), 'user role label should be "user"');
  assert.ok(result.includes('assistant: assistant response'), 'assistant role label should be "assistant"');
}

// ── runner ───────────────────────────────────────────────────────────────────

const tests: Array<[string, () => void]> = [
  ['1. empty history', testEmptyHistory],
  ['2. no text items in history', testNoTextItems],
  ['3. chat path — no duplication', testChatPath],
  ['4. voice path — appended to context', testVoicePath],
  ['5. recentTurns limit respected', testRecentTurnsLimit],
  ['6. long content truncated to 200 chars', testTruncation],
  ['7. user and assistant role labels', testRoleLabels],
];

let passed = 0;
let failed = 0;

for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}: ${err?.message || err}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
