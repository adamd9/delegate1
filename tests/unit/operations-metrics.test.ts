import assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

async function main() {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'delegate-operations-'));
  process.env.RUNTIME_DATA_DIR = runtimeDir;

  const sqlite = await import('../../src/db/sqlite');
  sqlite.upsertSession('session-1');
  sqlite.upsertConversation({
    id: 'conversation-1',
    session_id: 'session-1',
    channel: 'text',
    started_at: new Date().toISOString(),
  });
  const addEvent = (kind: string, payload: Record<string, unknown>) => sqlite.addConversationEvent({
    conversation_id: 'conversation-1', kind, payload, created_at_ms: Date.now(),
  });
  addEvent('context_compaction_attempt', { phase: 'started', source: 'manual' });
  addEvent('context_compaction_attempt', { phase: 'completed', source: 'manual' });
  addEvent('context_compacted', { protocol: 'responses' });
  addEvent('memory_dedup', { suppressed: 3, new: 2 });
  addEvent('memory_late_outcome', { outcome: 'suppressed', reason: 'already_surfaced', elapsed_ms: 400 });
  addEvent('memory_late_outcome', { outcome: 'surfaced', count: 1, elapsed_ms: 600 });

  const db = sqlite.getDb();
  db.prepare(`
    INSERT INTO copilot_tasks (
      id, title, status, workdir, created_at_ms, last_active_at_ms, turn_count, archived
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0)
  `).run('task-1', 'Metrics task', 'completed', runtimeDir, Date.now(), Date.now());
  const addTaskEvent = (payload: Record<string, unknown>) => db.prepare(`
    INSERT INTO copilot_task_events (task_id, created_at_ms, kind, payload_json)
    VALUES ('task-1', ?, 'system', ?)
  `).run(Date.now(), JSON.stringify(payload));
  addTaskEvent({ delivery: 'failed', attempts: 1 });
  addTaskEvent({ delivery: 'delivered', attempts: 2 });

  const { getOperationsMetrics } = await import('../../src/observability/operationsMetrics');
  const metrics = getOperationsMetrics(Date.now() - 60_000);
  assert.deepStrictEqual(metrics.context.manualCompaction, {
    attempts: 1, successes: 1, failures: 0, successRate: 1,
  });
  assert.strictEqual(metrics.context.automaticCompactions, 1);
  assert.deepStrictEqual(metrics.delivery, {
    successes: 1,
    failedAttempts: 1,
    retryAttempts: 1,
    attemptSuccessRate: 0.5,
    retryRate: 0.5,
  });
  assert.deepStrictEqual(metrics.memory.durableWindow, { suppressed: 3, surfaced: 2 });
  assert.deepStrictEqual(metrics.memory.lateResults, {
    suppressed: 1, surfaced: 1, averageLatencyMs: 500,
  });
  assert.strictEqual(metrics.timelinePaging.scope, 'process_runtime');

  db.close();
  rmSync(runtimeDir, { recursive: true, force: true });
  console.log('operations metrics tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});