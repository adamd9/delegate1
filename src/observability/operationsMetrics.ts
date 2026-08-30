import { getDb } from '../db/sqlite';
import { memoryModule } from '../memory';
import { getContextStatus } from '../session/contextControl';
import { getTimelinePagingMetrics } from '../session/history';

type EventRow = { kind: string; payload_json: string };

function parsePayload(row: EventRow): Record<string, any> {
  try { return JSON.parse(row.payload_json || '{}'); } catch { return {}; }
}

export function getOperationsMetrics(sinceMs: number) {
  const db = getDb();
  const eventRows = db.prepare(`
    SELECT kind, payload_json
    FROM conversation_events
    WHERE created_at_ms >= ?
      AND kind IN ('context_compaction_attempt', 'context_compacted', 'memory_dedup', 'memory_late_outcome')
  `).all(sinceMs) as EventRow[];

  let manualCompactionAttempts = 0;
  let manualCompactionSuccesses = 0;
  let manualCompactionFailures = 0;
  let automaticCompactions = 0;
  let memoriesSuppressed = 0;
  let memoriesSurfaced = 0;
  let lateResultsSuppressed = 0;
  let lateResultsSurfaced = 0;
  let lateResultLatencyMs = 0;
  let lateResultLatencySamples = 0;
  for (const row of eventRows) {
    const payload = parsePayload(row);
    if (row.kind === 'context_compaction_attempt') {
      if (payload.phase === 'started') manualCompactionAttempts += 1;
      if (payload.phase === 'completed') manualCompactionSuccesses += 1;
      if (payload.phase === 'failed') manualCompactionFailures += 1;
    } else if (row.kind === 'context_compacted' && payload.source !== 'manual') {
      automaticCompactions += 1;
    } else if (row.kind === 'memory_dedup') {
      memoriesSuppressed += Number(payload.suppressed) || 0;
      memoriesSurfaced += Number(payload.new) || 0;
    } else if (row.kind === 'memory_late_outcome') {
      if (payload.outcome === 'suppressed') lateResultsSuppressed += 1;
      if (payload.outcome === 'surfaced') lateResultsSurfaced += 1;
      if (Number.isFinite(Number(payload.elapsed_ms))) {
        lateResultLatencyMs += Number(payload.elapsed_ms);
        lateResultLatencySamples += 1;
      }
    }
  }

  const deliveryRows = db.prepare(`
    SELECT payload_json
    FROM copilot_task_events
    WHERE created_at_ms >= ? AND kind = 'system'
  `).all(sinceMs) as Array<{ payload_json: string }>;
  let deliverySuccesses = 0;
  let deliveryFailures = 0;
  let deliveryRetries = 0;
  for (const row of deliveryRows) {
    const payload = parsePayload({ kind: 'system', payload_json: row.payload_json });
    if (payload.delivery === 'delivered') deliverySuccesses += 1;
    if (payload.delivery === 'failed') deliveryFailures += 1;
    if (payload.delivery && Number(payload.attempts) > 1) deliveryRetries += 1;
  }

  const deliveryAttempts = deliverySuccesses + deliveryFailures;
  return {
    generatedAtMs: Date.now(),
    window: { sinceMs },
    context: {
      status: getContextStatus(),
      manualCompaction: {
        attempts: manualCompactionAttempts,
        successes: manualCompactionSuccesses,
        failures: manualCompactionFailures,
        successRate: manualCompactionAttempts > 0
          ? manualCompactionSuccesses / manualCompactionAttempts
          : null,
      },
      automaticCompactions,
    },
    delivery: {
      successes: deliverySuccesses,
      failedAttempts: deliveryFailures,
      retryAttempts: deliveryRetries,
      attemptSuccessRate: deliveryAttempts > 0 ? deliverySuccesses / deliveryAttempts : null,
      retryRate: deliveryAttempts > 0 ? deliveryRetries / deliveryAttempts : null,
    },
    timelinePaging: {
      scope: 'process_runtime',
      ...getTimelinePagingMetrics(),
    },
    memory: {
      durableWindow: { suppressed: memoriesSuppressed, surfaced: memoriesSurfaced },
      lateResults: {
        suppressed: lateResultsSuppressed,
        surfaced: lateResultsSurfaced,
        averageLatencyMs: lateResultLatencySamples > 0
          ? Math.round(lateResultLatencyMs / lateResultLatencySamples)
          : null,
      },
      processRuntime: memoryModule.getDedupMetrics(),
    },
  };
}