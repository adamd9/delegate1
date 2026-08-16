import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { conversationBus } from '../memory/conversationBus';
import type { Channel } from '../agentConfigs/context';

// Resolve DB path for containerized deployments.
// Use RUNTIME_DATA_DIR when provided (e.g., in Docker/K8s), otherwise use local dev default.
const RUNTIME_DATA_DIR = process.env.RUNTIME_DATA_DIR;
const DB_FILE = RUNTIME_DATA_DIR
  ? join(RUNTIME_DATA_DIR, 'db', 'assistant.sqlite')
  : join(__dirname, '..', '..', 'runtime-data', 'db', 'assistant.sqlite');

let databaseInstance: any | null = null;
const LEDGER_DEBUG = (process.env.LEDGER_DEBUG || '').toLowerCase() === 'true';

function getJournalMode(): 'WAL' | 'DELETE' {
  const configured = String(process.env.SQLITE_JOURNAL_MODE || '').trim().toUpperCase();
  if (configured === 'WAL' || configured === 'DELETE') return configured;
  return RUNTIME_DATA_DIR ? 'DELETE' : 'WAL';
}

export function getDb() {
  if (databaseInstance) return databaseInstance;
  const dir = dirname(DB_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  databaseInstance = new Database(DB_FILE);
  databaseInstance.pragma(`journal_mode = ${getJournalMode()}`);
  databaseInstance.pragma('busy_timeout = 5000');
  databaseInstance.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT,
      sensitive INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT,
      ended_at TEXT,
      status TEXT,
      metadata_json TEXT
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      channel TEXT,
      started_at TEXT,
      ended_at TEXT,
      status TEXT,
      duration_ms INTEGER,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      path TEXT NOT NULL,
      type TEXT,
      created_at TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS conversation_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_events_conversation_seq
      ON conversation_events(conversation_id, seq);
    CREATE INDEX IF NOT EXISTS idx_conversation_events_conversation_created_at
      ON conversation_events(conversation_id, created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_conversation_events_created_at
      ON conversation_events(created_at_ms, id);
    CREATE TABLE IF NOT EXISTS thoughtflow_artifacts (
      artifact_id TEXT NOT NULL,
      format TEXT NOT NULL,
      session_id TEXT NOT NULL,
      conversation_id TEXT,
      content TEXT,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (artifact_id, format),
      FOREIGN KEY(session_id) REFERENCES sessions(id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_thoughtflow_artifacts_session
      ON thoughtflow_artifacts(session_id);
    CREATE INDEX IF NOT EXISTS idx_thoughtflow_artifacts_conversation
      ON thoughtflow_artifacts(conversation_id);

    CREATE TABLE IF NOT EXISTS deepgram_transcripts (
      id TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL,
      transcript TEXT NOT NULL,
      is_final INTEGER,
      session_hint TEXT,
      meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_deepgram_transcripts_created_at
      ON deepgram_transcripts(created_at_ms);

    CREATE TABLE IF NOT EXISTS copilot_tasks (
      id                          TEXT PRIMARY KEY,
      copilot_session_id          TEXT,
      title                       TEXT NOT NULL,
      status                      TEXT NOT NULL,
      workdir                     TEXT NOT NULL,
      originating_conversation_id TEXT,
      created_at_ms               INTEGER NOT NULL,
      last_active_at_ms           INTEGER NOT NULL,
      ended_at_ms                 INTEGER,
      last_prompt                 TEXT,
      last_summary                TEXT,
      needs_user_reason           TEXT,
      turn_count                  INTEGER DEFAULT 0,
      archived                    INTEGER DEFAULT 0,
      meta_json                   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_tasks_status         ON copilot_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_copilot_tasks_last_active    ON copilot_tasks(last_active_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_copilot_tasks_archived       ON copilot_tasks(archived);

    CREATE TABLE IF NOT EXISTS copilot_task_events (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id           TEXT NOT NULL,
      created_at_ms     INTEGER NOT NULL,
      kind              TEXT NOT NULL,        -- 'user_prompt' | 'agent_output' | 'agent_stderr' | 'system' | 'needs_user' | 'turn_start' | 'turn_end' | 'cancelled'
      payload_json      TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES copilot_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_task_events_task ON copilot_task_events(task_id, id);

    CREATE TABLE IF NOT EXISTS inner_signals (
      id                TEXT PRIMARY KEY,
      kind              TEXT NOT NULL,
      source            TEXT NOT NULL,
      awareness_mode    TEXT NOT NULL,
      priority          INTEGER NOT NULL DEFAULT 0,
      payload_json      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      created_at_ms     INTEGER NOT NULL,
      available_at_ms   INTEGER NOT NULL,
      claimed_at_ms     INTEGER,
      handled_at_ms     INTEGER,
      attempts          INTEGER NOT NULL DEFAULT 0,
      last_error        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inner_signals_pending
      ON inner_signals(status, available_at_ms, priority DESC, created_at_ms ASC);
  `);
  const conversationColumns = databaseInstance.pragma('table_info(conversations)') as Array<{ name: string }>;
  if (!conversationColumns.some(column => column.name === 'last_checkpoint_seq')) {
    databaseInstance.exec('ALTER TABLE conversations ADD COLUMN last_checkpoint_seq INTEGER NOT NULL DEFAULT 0');
  }
  if (!conversationColumns.some(column => column.name === 'last_checkpoint_at_ms')) {
    databaseInstance.exec('ALTER TABLE conversations ADD COLUMN last_checkpoint_at_ms INTEGER');
  }
  return databaseInstance;
}

export const db = new Proxy({} as any, {
  get(_target, prop) {
    const database = getDb();
    const value = database[prop];
    return typeof value === 'function' ? value.bind(database) : value;
  },
});

export function upsertSession(id: string, started_at?: string) {
  const db = getDb();
  const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
  if (row) return;
  db.prepare('INSERT INTO sessions (id, started_at, status) VALUES (?, ?, ?)').run(id, started_at || new Date().toISOString(), 'open');
}

export function finalizeSession(id: string, status: string, ended_at?: string) {
  const db = getDb();
  db.prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?').run(status, ended_at || new Date().toISOString(), id);
}

export function upsertConversation(conv: { id: string; session_id: string; channel?: string; started_at?: string; }) {
  const db = getDb();
  const row = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conv.id);
  if (row) return;
  db.prepare('INSERT INTO conversations (id, session_id, channel, started_at, status) VALUES (?, ?, ?, ?, ?)')
    .run(conv.id, conv.session_id, conv.channel || null, conv.started_at || new Date().toISOString(), 'open');
}

export function completeConversation(conv: { id: string; status?: string; ended_at?: string; duration_ms?: number; }) {
  checkpointConversation(conv.id, 'conversation_end');
  updateConversationStatus(conv);
  conversationBus.emitConversationClosed(conv.id);
}

export function checkpointConversation(conversationId: string, reason: string = 'idle', spanId?: string): {
  checkpointSeq: number;
  turnCount: number;
} | null {
  const database = getDb();
  const checkpoint = database.transaction(() => {
    const conversation = database.prepare(
      'SELECT last_checkpoint_seq FROM conversations WHERE id = ?'
    ).get(conversationId) as { last_checkpoint_seq?: number } | undefined;
    if (!conversation) return null;
    const previousSeq = Number(conversation.last_checkpoint_seq || 0);
    const rows = database.prepare(`
      SELECT seq, kind, payload_json
      FROM conversation_events
      WHERE conversation_id = ? AND seq > ? AND kind IN ('message_user', 'message_assistant')
      ORDER BY seq ASC
    `).all(conversationId, previousSeq) as Array<{ seq: number; kind: string; payload_json: string }>;
    const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    let channel = 'text';
    let checkpointSeq = previousSeq;
    for (const row of rows) {
      checkpointSeq = Math.max(checkpointSeq, row.seq);
      const payload = (() => { try { return JSON.parse(row.payload_json); } catch { return {}; } })();
      if (payload.internal) continue;
      if (payload.channel) channel = payload.channel;
      turns.push({ role: row.kind === 'message_user' ? 'user' : 'assistant', text: payload.text || '' });
    }
    if (!turns.length) return null;
    const createdAtMs = Date.now();
    const eventId = `ti_checkpoint_${conversationId}_${checkpointSeq}`;
    const seq = nextSeqByConversation(conversationId);
    database.prepare(`
      INSERT OR IGNORE INTO conversation_events
        (id, conversation_id, seq, kind, payload_json, created_at_ms)
      VALUES (?, ?, ?, 'conversation_checkpoint', ?, ?)
    `).run(eventId, conversationId, seq, JSON.stringify({
      reason,
      ...(spanId ? { span_id: spanId } : {}),
      from_seq: previousSeq + 1,
      through_seq: checkpointSeq,
      turn_count: turns.length,
    }), createdAtMs);
    database.prepare(`
      UPDATE conversations
      SET last_checkpoint_seq = ?, last_checkpoint_at_ms = ?
      WHERE id = ?
    `).run(checkpointSeq, createdAtMs, conversationId);
    return { checkpointSeq, turns, channel, createdAtMs };
  })();
  if (!checkpoint) return null;
  conversationBus.emitConversationCheckpoint({
    conversationId,
    channel: checkpoint.channel as Channel,
    turns: checkpoint.turns,
    checkpointSeq: checkpoint.checkpointSeq,
    spanId,
  });
  return { checkpointSeq: checkpoint.checkpointSeq, turnCount: checkpoint.turns.length };
}

/** Update conversation status in DB without emitting the conversation bus event.
 *  Used by observability/thoughtflow for bookkeeping without triggering memory extraction. */
export function updateConversationStatus(conv: { id: string; status?: string; ended_at?: string; duration_ms?: number; }) {
  const db = getDb();
  db.prepare('UPDATE conversations SET status = COALESCE(?, status), ended_at = COALESCE(?, ended_at), duration_ms = COALESCE(?, duration_ms) WHERE id = ?')
    .run(conv.status || null, conv.ended_at || null, conv.duration_ms != null ? conv.duration_ms : null, conv.id);
}

export function listSessions(limit: number) {
  const db = getDb();
  return db.prepare('SELECT id, started_at, ended_at, status FROM sessions ORDER BY COALESCE(ended_at, started_at) DESC LIMIT ?').all(limit);
}

export function getSessionDetail(id: string) {
  const db = getDb();
  const session = db.prepare('SELECT id, started_at, ended_at, status FROM sessions WHERE id = ?').get(id);
  if (!session) return null;
  const conversations = db.prepare('SELECT id, session_id, channel, started_at, ended_at, status, duration_ms FROM conversations WHERE session_id = ? ORDER BY started_at ASC').all(id);
  const canvases = db.prepare('SELECT id, session_id, path, type, created_at FROM canvases WHERE session_id = ? ORDER BY created_at ASC').all(id);
  const events = db.prepare('SELECT ti.id, ti.conversation_id, ti.seq, ti.kind, ti.payload_json, ti.created_at_ms FROM conversation_events ti JOIN conversations c ON ti.conversation_id = c.id WHERE c.session_id = ? ORDER BY ti.seq ASC').all(id);
  return { session, conversations, canvases, events };
}

export function listConversations(limit: number) {
  const db = getDb();
  return db.prepare(`
    SELECT id, session_id, channel, started_at, ended_at, status, duration_ms
    FROM conversations
    ORDER BY COALESCE(
      (SELECT MAX(e.created_at_ms) FROM conversation_events e WHERE e.conversation_id = conversations.id),
      CAST(strftime('%s', COALESCE(ended_at, started_at)) AS INTEGER) * 1000
    ) DESC
    LIMIT ?
  `).all(limit);
}

export function getConversationById(id: string) {
  const db = getDb();
  const conv = db.prepare('SELECT id, session_id, channel, started_at, ended_at, status, duration_ms FROM conversations WHERE id = ?').get(id);
  if (!conv) return null;
  return { conversation: conv };
}

export function addCanvas(rec: { id: string; session_id: string; path: string; type?: string; created_at?: string; }) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO canvases (id, session_id, path, type, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(rec.id, rec.session_id, rec.path, rec.type || null, rec.created_at || new Date().toISOString());
}

export function nextSeqByConversation(conversation_id: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM conversation_events WHERE conversation_id = ?').get(conversation_id);
  return (row?.max_seq || 0) + 1;
}

export function addConversationEvent(rec: { id?: string; conversation_id: string; kind: string; payload: any; created_at_ms?: number; }) {
  const db = getDb();
  const id = rec.id || `ti_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const seq = nextSeqByConversation(rec.conversation_id);
  const created_at_ms = rec.created_at_ms || Date.now();
  const payload_json = JSON.stringify(rec.payload ?? {});
  db.prepare('INSERT INTO conversation_events (id, conversation_id, seq, kind, payload_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, rec.conversation_id, seq, rec.kind, payload_json, created_at_ms);
  if (LEDGER_DEBUG) {
    try {
      console.debug(`[ledger] event insert conv=${rec.conversation_id} id=${id} seq=${seq} kind=${rec.kind} ts=${created_at_ms}`);
    } catch {}
  }
  // Emit turn_complete when an assistant message is committed — single hook point for all channels
  if (rec.kind === 'message_assistant') {
    try {
      const activationEvent = getLastActivationEventForConversation(rec.conversation_id);
      if (activationEvent) {
        const assistantPayload = rec.payload || {};
        console.log(`[memory] turn_complete emit — conv: ${rec.conversation_id} channel: ${activationEvent.channel || assistantPayload.channel}`);
        conversationBus.emitTurnComplete({
          userContent: activationEvent.text || '',
          assistantContent: assistantPayload.text || '',
          channel: (activationEvent.channel || assistantPayload.channel || 'text') as Channel,
          conversationId: rec.conversation_id,
          activationRole: activationEvent.kind === 'inner_context' ? 'inner_context' : 'user',
        });
      }
    } catch {}
  }  return { id, seq };
}

export function addDeepgramTranscript(rec: {
  transcript: string;
  is_final?: boolean;
  created_at_ms?: number;
  session_hint?: string;
  meta?: any;
}) {
  const db = getDb();
  const created_at_ms = rec.created_at_ms || Date.now();
  const id = `dg_${created_at_ms}_${Math.random().toString(36).slice(2, 8)}`;
  const meta_json = JSON.stringify(rec.meta ?? {});
  db.prepare(
    'INSERT INTO deepgram_transcripts (id, created_at_ms, transcript, is_final, session_hint, meta_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, created_at_ms, rec.transcript, rec.is_final ? 1 : 0, rec.session_hint || null, meta_json);
  return { id };
}

/** Returns the most recent outer or inner activation payload for the conversation bus hook. */
function getLastActivationEventForConversation(conversation_id: string): { text: string; channel: string; kind: string } | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT kind, payload_json FROM conversation_events WHERE conversation_id = ? AND kind IN ('message_user', 'inner_context') ORDER BY seq DESC LIMIT 1"
  ).get(conversation_id) as { kind: string; payload_json: string } | undefined;
  if (!row) return null;
  try { return { ...JSON.parse(row.payload_json), kind: row.kind }; } catch { return null; }
}

export function listConversationEvents(conversation_id: string) {
  const db = getDb();
  return db.prepare('SELECT id, conversation_id, seq, kind, payload_json, created_at_ms FROM conversation_events WHERE conversation_id = ? ORDER BY seq ASC').all(conversation_id);
}

export type TimelineCursor = { createdAtMs: number; id: string };

function isOlderTimelinePosition(left: TimelineCursor, right: TimelineCursor): boolean {
  return left.createdAtMs < right.createdAtMs
    || (left.createdAtMs === right.createdAtMs && left.id < right.id);
}

export function listTimelineEvents(limit: number, cursor?: TimelineCursor) {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit || 500)));
  const select = `
    SELECT
      e.id,
      e.conversation_id,
      e.seq,
      e.kind,
      e.payload_json,
      e.created_at_ms,
      c.session_id,
      c.channel AS conversation_channel,
      c.ended_at AS conversation_ended_at,
      c.status AS conversation_status
    FROM conversation_events e
    JOIN conversations c ON c.id = e.conversation_id
  `;
  const upperWhere = cursor
    ? 'WHERE (e.created_at_ms < ? OR (e.created_at_ms = ? AND e.id < ?))'
    : '';
  const upperParams = cursor ? [cursor.createdAtMs, cursor.createdAtMs, cursor.id] : [];
  let rows = db.prepare(`${select}
    ${upperWhere}
    ORDER BY e.created_at_ms DESC, e.id DESC
    LIMIT ?
  `).all(...upperParams, safeLimit + 1) as any[];
  if (rows.length > safeLimit) rows.pop();

  // Do not bisect a modern activity span. Extend the lower boundary to any
  // span start that owns the earliest selected event for each conversation.
  for (let pass = 0; rows.length && pass < 20; pass += 1) {
    const earliestByConversation = new Map<string, any>();
    for (const row of rows) earliestByConversation.set(row.conversation_id, row);
    let boundary: TimelineCursor = {
      createdAtMs: rows[rows.length - 1].created_at_ms,
      id: rows[rows.length - 1].id,
    };
    for (const earliest of earliestByConversation.values()) {
      const lifecycle = db.prepare(`
        SELECT id, kind, payload_json, created_at_ms
        FROM conversation_events
        WHERE conversation_id = ?
          AND kind IN ('activity_span_started', 'activity_span_closed')
          AND (created_at_ms < ? OR (created_at_ms = ? AND id <= ?))
        ORDER BY created_at_ms DESC, id DESC
        LIMIT 1
      `).get(
        earliest.conversation_id,
        earliest.created_at_ms,
        earliest.created_at_ms,
        earliest.id,
      ) as any;
      if (lifecycle?.kind !== 'activity_span_started') continue;
      const lifecyclePosition = { createdAtMs: lifecycle.created_at_ms, id: lifecycle.id };
      if (isOlderTimelinePosition(lifecyclePosition, boundary)) boundary = lifecyclePosition;
    }
    const currentBoundary = {
      createdAtMs: rows[rows.length - 1].created_at_ms,
      id: rows[rows.length - 1].id,
    };
    if (!isOlderTimelinePosition(boundary, currentBoundary)) break;
    const lowerWhere = '(e.created_at_ms > ? OR (e.created_at_ms = ? AND e.id >= ?))';
    rows = db.prepare(`${select}
      ${upperWhere ? `${upperWhere} AND` : 'WHERE'} ${lowerWhere}
      ORDER BY e.created_at_ms DESC, e.id DESC
    `).all(
      ...upperParams,
      boundary.createdAtMs,
      boundary.createdAtMs,
      boundary.id,
    ) as any[];
  }

  const oldest = rows.length ? {
    createdAtMs: rows[rows.length - 1].created_at_ms,
    id: rows[rows.length - 1].id,
  } : null;
  const hasMore = Boolean(oldest && db.prepare(`
    SELECT 1 FROM conversation_events
    WHERE created_at_ms < ? OR (created_at_ms = ? AND id < ?)
    LIMIT 1
  `).get(oldest.createdAtMs, oldest.createdAtMs, oldest.id));
  return {
    events: rows.reverse(),
    hasMore,
    limit: safeLimit,
    nextCursor: hasMore ? oldest : null,
  };
}

export function listRecentMemoryEvents(limit: number = 100): Array<{
  id: string;
  conversation_id: string;
  session_id: string | null;
  kind: string;
  payload: any;
  created_at_ms: number;
}> {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit || 100)));
  const rows = db.prepare(`
    SELECT
      e.id,
      e.conversation_id,
      c.session_id,
      e.kind,
      e.payload_json,
      e.created_at_ms
    FROM conversation_events e
    LEFT JOIN conversations c ON c.id = e.conversation_id
    WHERE e.kind IN ('memory_stored', 'memory_dedup', 'memory_arbitrator', 'memory_retrieved', 'memory_pending', 'memory_miss')
    ORDER BY e.created_at_ms DESC
    LIMIT ?
  `).all(safeLimit) as Array<any>;

  return rows.map(r => ({
    id: r.id,
    conversation_id: r.conversation_id,
    session_id: r.session_id ?? null,
    kind: r.kind,
    payload: (() => {
      try { return JSON.parse(r.payload_json || '{}'); } catch { return {}; }
    })(),
    created_at_ms: r.created_at_ms,
  }));
}

export function getLastEventTimestampForConversation(conversation_id: string): number | null {
  const db = getDb();
  const row = db.prepare('SELECT created_at_ms FROM conversation_events WHERE conversation_id = ? ORDER BY seq DESC LIMIT 1').get(conversation_id);
  return row?.created_at_ms ?? null;
}

export function getEventCountForSession(session_id: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(1) AS cnt FROM conversation_events ti JOIN conversations c ON ti.conversation_id = c.id WHERE c.session_id = ?').get(session_id);
  return row?.cnt || 0;
}

export type ThoughtflowArtifactFormat = 'json' | 'd2' | 'jsonl';

export function upsertThoughtflowArtifact(rec: {
  artifact_id: string;
  session_id: string;
  conversation_id?: string | null;
  format: ThoughtflowArtifactFormat;
  content: string;
  created_at?: string;
  updated_at?: string;
}) {
  const db = getDb();
  const createdAt = rec.created_at || new Date().toISOString();
  const updatedAt = rec.updated_at || createdAt;
  db.prepare(`
    INSERT INTO thoughtflow_artifacts (artifact_id, format, session_id, conversation_id, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_id, format) DO UPDATE SET
      session_id = excluded.session_id,
      conversation_id = excluded.conversation_id,
      content = excluded.content,
      updated_at = excluded.updated_at
  `).run(
    rec.artifact_id,
    rec.format,
    rec.session_id,
    rec.conversation_id || null,
    rec.content,
    createdAt,
    updatedAt
  );
}

export function getThoughtflowArtifact(artifact_id: string, format: ThoughtflowArtifactFormat) {
  const db = getDb();
  return db.prepare('SELECT artifact_id, format, session_id, conversation_id, content, created_at, updated_at FROM thoughtflow_artifacts WHERE artifact_id = ? AND format = ?')
    .get(artifact_id, format);
}

export function listThoughtflowArtifacts() {
  const db = getDb();
  return db
    .prepare(
      `SELECT artifact_id, format, session_id, conversation_id, created_at, updated_at
       FROM thoughtflow_artifacts
       ORDER BY COALESCE(updated_at, created_at) DESC`
    )
    .all();
}
