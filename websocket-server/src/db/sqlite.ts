import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

// Resolve DB path for containerized deployments.
// Use RUNTIME_DATA_DIR when provided (e.g., in Docker/K8s), otherwise use local dev default.
const RUNTIME_DATA_DIR = process.env.RUNTIME_DATA_DIR;
const DB_FILE = RUNTIME_DATA_DIR
  ? join(RUNTIME_DATA_DIR, 'db', 'assistant.sqlite')
  : join(__dirname, '..', '..', 'runtime-data', 'db', 'assistant.sqlite');

let db: any | null = null;
const LEDGER_DEBUG = (process.env.LEDGER_DEBUG || '').toLowerCase() === 'true';

export function getDb() {
  if (db) return db;
  const dir = dirname(DB_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.exec(`
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
  `);
  return db;
}

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
  return db.prepare('SELECT id, session_id, channel, started_at, ended_at, status, duration_ms FROM conversations ORDER BY COALESCE(ended_at, started_at) DESC LIMIT ?').all(limit);
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
  return { id, seq };
}

export function listConversationEvents(conversation_id: string) {
  const db = getDb();
  return db.prepare('SELECT id, conversation_id, seq, kind, payload_json, created_at_ms FROM conversation_events WHERE conversation_id = ? ORDER BY seq ASC').all(conversation_id);
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
