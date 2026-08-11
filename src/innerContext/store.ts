import { randomUUID } from 'crypto';
import { getDb } from '../db/sqlite';
import type { InnerSignal, InnerSignalInput, InnerSignalStore } from './types';

type SignalRow = {
  id: string;
  kind: string;
  source: string;
  awareness_mode: InnerSignal['awarenessMode'];
  priority: number;
  payload_json: string;
  created_at_ms: number;
  attempts: number;
};

function fromRow(row: SignalRow): InnerSignal {
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    awarenessMode: row.awareness_mode,
    priority: row.priority,
    payload: JSON.parse(row.payload_json),
    createdAtMs: row.created_at_ms,
    attempts: row.attempts,
  };
}

export class SqliteInnerSignalStore implements InnerSignalStore {
  publish(input: InnerSignalInput): { signal: InnerSignal; inserted: boolean } {
    const database = getDb();
    const signal: InnerSignal = {
      id: input.id || `inner_${randomUUID()}`,
      kind: input.kind,
      source: input.source,
      awarenessMode: input.awarenessMode,
      priority: input.priority || 0,
      payload: input.payload,
      createdAtMs: input.createdAtMs || Date.now(),
      attempts: 0,
    };
    const result = database.prepare(`
      INSERT OR IGNORE INTO inner_signals
        (id, kind, source, awareness_mode, priority, payload_json, status, created_at_ms, available_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      signal.id,
      signal.kind,
      signal.source,
      signal.awarenessMode,
      signal.priority,
      JSON.stringify(signal.payload),
      signal.createdAtMs,
      signal.createdAtMs,
    );
    return { signal, inserted: result.changes > 0 };
  }

  hasPendingWake(nowMs: number): boolean {
    const row = getDb().prepare(`
      SELECT 1 FROM inner_signals
      WHERE status = 'pending' AND available_at_ms <= ? AND awareness_mode IN ('wake', 'interrupt')
      LIMIT 1
    `).get(nowMs);
    return Boolean(row);
  }

  nextPendingWakeAt(): number | undefined {
    const row = getDb().prepare(`
      SELECT MIN(available_at_ms) AS available_at_ms FROM inner_signals
      WHERE status = 'pending' AND awareness_mode IN ('wake', 'interrupt')
    `).get() as { available_at_ms?: number | null } | undefined;
    return typeof row?.available_at_ms === 'number' ? row.available_at_ms : undefined;
  }

  claimBatch(nowMs: number, limit: number, leaseMs: number): InnerSignal[] {
    const database = getDb();
    return database.transaction(() => {
      database.prepare(`
        UPDATE inner_signals
        SET status = 'pending', claimed_at_ms = NULL
        WHERE status = 'claimed' AND claimed_at_ms <= ?
      `).run(nowMs - leaseMs);

      const wake = database.prepare(`
        SELECT 1 FROM inner_signals
        WHERE status = 'pending' AND available_at_ms <= ? AND awareness_mode IN ('wake', 'interrupt')
        LIMIT 1
      `).get(nowMs);
      if (!wake) return [];

      const rows = database.prepare(`
        SELECT id, kind, source, awareness_mode, priority, payload_json, created_at_ms, attempts
        FROM inner_signals
        WHERE status = 'pending' AND available_at_ms <= ? AND awareness_mode != 'ambient'
        ORDER BY priority DESC, created_at_ms ASC
        LIMIT ?
      `).all(nowMs, limit) as SignalRow[];
      if (!rows.length) return [];

      const placeholders = rows.map(() => '?').join(', ');
      database.prepare(`
        UPDATE inner_signals
        SET status = 'claimed', claimed_at_ms = ?, attempts = attempts + 1
        WHERE id IN (${placeholders})
      `).run(nowMs, ...rows.map(row => row.id));
      return rows.map(row => fromRow({ ...row, attempts: row.attempts + 1 }));
    })();
  }

  claimForTurn(nowMs: number, limit: number, leaseMs: number): InnerSignal[] {
    const database = getDb();
    return database.transaction(() => {
      database.prepare(`
        UPDATE inner_signals
        SET status = 'pending', claimed_at_ms = NULL
        WHERE status = 'claimed' AND claimed_at_ms <= ?
      `).run(nowMs - leaseMs);

      const rows = database.prepare(`
        SELECT id, kind, source, awareness_mode, priority, payload_json, created_at_ms, attempts
        FROM inner_signals
        WHERE status = 'pending' AND available_at_ms <= ? AND awareness_mode != 'ambient'
        ORDER BY priority DESC, created_at_ms ASC
        LIMIT ?
      `).all(nowMs, limit) as SignalRow[];
      if (!rows.length) return [];

      const placeholders = rows.map(() => '?').join(', ');
      database.prepare(`
        UPDATE inner_signals
        SET status = 'claimed', claimed_at_ms = ?, attempts = attempts + 1
        WHERE id IN (${placeholders})
      `).run(nowMs, ...rows.map(row => row.id));
      return rows.map(row => fromRow({ ...row, attempts: row.attempts + 1 }));
    })();
  }

  markHandled(ids: string[], handledAtMs: number): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(', ');
    getDb().prepare(`
      UPDATE inner_signals SET status = 'handled', handled_at_ms = ?, claimed_at_ms = NULL
      WHERE id IN (${placeholders})
    `).run(handledAtMs, ...ids);
  }

  markFailed(ids: string[], error: string, availableAtMs: number): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(', ');
    getDb().prepare(`
      UPDATE inner_signals
      SET status = 'pending', available_at_ms = ?, claimed_at_ms = NULL, last_error = ?
      WHERE id IN (${placeholders})
    `).run(availableAtMs, error.slice(0, 2000), ...ids);
  }
}