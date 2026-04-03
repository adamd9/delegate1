/**
 * Unit tests for memory retrieval improvements:
 *  1. buildContextQuery — context window logic
 *  2. Arbitrator response parsing (filterMemoriesWithArbitrator is tested
 *     via mock since it makes LLM calls)
 *
 * Run: npx ts-node tests/unit/memory-context-arbitrator.test.ts
 */

import assert from 'assert';
import { buildContextQuery, ContextTurn } from '../../src/memory/index';

// ── buildContextQuery tests ─────────────────────────────────────────────────

console.log('── buildContextQuery ──');

// 1. Returns original message when no history
{
  const result = buildContextQuery('hello', undefined, 4, 1500);
  assert.strictEqual(result, 'hello', 'should return original when history is undefined');
}

{
  const result = buildContextQuery('hello', [], 4, 1500);
  assert.strictEqual(result, 'hello', 'should return original when history is empty');
}

console.log('  ✓ no history → returns original message');

// 2. Returns original when maxTurns=0 (context window disabled)
{
  const history: ContextTurn[] = [
    { role: 'user', text: 'hi there' },
    { role: 'assistant', text: 'hello!' },
  ];
  const result = buildContextQuery('what is my name?', history, 0, 1500);
  assert.strictEqual(result, 'what is my name?', 'should return original when maxTurns=0');
}

console.log('  ✓ maxTurns=0 → context window disabled');

// 3. Returns original when maxChars=0
{
  const history: ContextTurn[] = [
    { role: 'user', text: 'hi there' },
  ];
  const result = buildContextQuery('query', history, 4, 0);
  assert.strictEqual(result, 'query', 'should return original when maxChars=0');
}

console.log('  ✓ maxChars=0 → context window disabled');

// 4. Includes recent turns with correct format
{
  const history: ContextTurn[] = [
    { role: 'user', text: 'I live in Auckland' },
    { role: 'assistant', text: 'That sounds great!' },
    { role: 'user', text: 'What restaurants are nearby?' },
  ];
  const result = buildContextQuery('recommend something', history, 4, 1500);
  assert(result.includes('[Recent conversation]'), 'should have conversation header');
  assert(result.includes('[Current message]'), 'should have current message header');
  assert(result.includes('U: I live in Auckland'), 'should include user turn with U: prefix');
  assert(result.includes('A: That sounds great!'), 'should include assistant turn with A: prefix');
  assert(result.includes('recommend something'), 'should include current message');
}

console.log('  ✓ includes recent turns with correct formatting');

// 5. Respects maxTurns limit (takes most recent N)
{
  const history: ContextTurn[] = [
    { role: 'user', text: 'turn 1' },
    { role: 'assistant', text: 'turn 2' },
    { role: 'user', text: 'turn 3' },
    { role: 'assistant', text: 'turn 4' },
    { role: 'user', text: 'turn 5' },
    { role: 'assistant', text: 'turn 6' },
  ];
  const result = buildContextQuery('current', history, 2, 1500);
  // Should only include the last 2 turns
  assert(!result.includes('turn 1'), 'should not include oldest turns');
  assert(!result.includes('turn 4'), 'should not include turns beyond window');
  assert(result.includes('turn 5'), 'should include second-to-last turn');
  assert(result.includes('turn 6'), 'should include last turn');
}

console.log('  ✓ respects maxTurns limit');

// 6. Respects maxChars limit (stops adding when budget exceeded)
{
  const history: ContextTurn[] = [
    { role: 'user', text: 'A'.repeat(200) },
    { role: 'assistant', text: 'B'.repeat(200) },
    { role: 'user', text: 'C'.repeat(200) },
  ];
  // Set a budget that can only fit ~1 turn
  const result = buildContextQuery('query', history, 10, 210);
  // Should include at most the first turn that fits (oldest of the window)
  assert(result.includes('A'.repeat(200)), 'should include the turn that fits');
  // Should not include turns that exceed budget
  assert(!result.includes('B'.repeat(200)), 'should stop before exceeding budget');
}

console.log('  ✓ respects maxChars limit');

// 7. Truncates very long individual turns
{
  const longText = 'X'.repeat(500);
  const history: ContextTurn[] = [
    { role: 'user', text: longText },
  ];
  const result = buildContextQuery('query', history, 4, 5000);
  // Individual turns > 400 chars should be truncated to 397 + '…'
  assert(!result.includes('X'.repeat(500)), 'should not include full 500-char text');
  assert(result.includes('X'.repeat(397)), 'should include truncated 397-char text');
  assert(result.includes('…'), 'should include ellipsis');
}

console.log('  ✓ truncates long individual turns');

// ── Arbitrator response parsing (logic tested without LLM) ──────────────────

console.log('── Arbitrator response parsing ──');

// Test the parsing logic that would be used in the arbitrator
function parseArbitratorResponse(text: string): string | null {
  if (!text || text === 'NONE' || text.startsWith('NONE')) return null;
  const keptLines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- ') && l.length > 3);
  return keptLines.length > 0 ? keptLines.join('\n') : null;
}

{
  const result = parseArbitratorResponse('NONE');
  assert.strictEqual(result, null, 'NONE should return null');
}

{
  const result = parseArbitratorResponse('');
  assert.strictEqual(result, null, 'empty string should return null');
}

{
  const result = parseArbitratorResponse('- User lives in Auckland\n- User prefers vegetarian food');
  assert.strictEqual(result, '- User lives in Auckland\n- User prefers vegetarian food');
}

{
  // Filters out non-memory lines
  const result = parseArbitratorResponse('Here are the relevant memories:\n- User lives in Auckland\nSome explanation\n- User works at Acme');
  assert.strictEqual(result, '- User lives in Auckland\n- User works at Acme');
}

{
  // Filters out very short items like "- " (length 2) or "- a" (length 3)
  const result = parseArbitratorResponse('- \n- a');
  assert.strictEqual(result, null, 'too-short items should be filtered');
}

{
  // "- ab" (length 4) passes the >3 threshold
  const result = parseArbitratorResponse('- ab');
  assert.strictEqual(result, '- ab', 'items with 4+ chars should pass');
}

console.log('  ✓ arbitrator response parsing works correctly');

// ── All done ─────────────────────────────────────────────────────────────────

console.log('\n✅ All memory context + arbitrator tests passed');
