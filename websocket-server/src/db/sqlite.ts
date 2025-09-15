import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const DB_FILE = process.env.DB_FILE || join(__dirname, '..', '..', 'runtime-data', 'db', 'assistant.sqlite');

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
    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      step_index INTEGER,
      label TEXT,
      started_at TEXT,
      ended_at TEXT,
      duration_ms INTEGER,
      payload_started_json TEXT,
      payload_completed_json TEXT,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id)
    );
    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      path TEXT NOT NULL,
      type TEXT,
      created_at TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS transcript_items (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id)
    );
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

export function stepStarted(step: { id: string; conversation_id: string; step_index?: number; label?: string; started_at?: string; payload_started_json?: string; }) {
  const db = getDb();
  const row = db.prepare('SELECT id FROM steps WHERE id = ?').get(step.id);
  if (row) return;
  db.prepare('INSERT INTO steps (id, conversation_id, step_index, label, started_at, payload_started_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(step.id, step.conversation_id, step.step_index || null, step.label || null, step.started_at || new Date().toISOString(), step.payload_started_json || null);
}

export function stepCompleted(step: { id: string; ended_at?: string; duration_ms?: number; payload_completed_json?: string; }) {
  const db = getDb();
  db.prepare('UPDATE steps SET ended_at = COALESCE(?, ended_at), duration_ms = COALESCE(?, duration_ms), payload_completed_json = COALESCE(?, payload_completed_json) WHERE id = ?')
    .run(step.ended_at || null, step.duration_ms != null ? step.duration_ms : null, step.payload_completed_json || null, step.id);
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
  const steps = db.prepare('SELECT id, conversation_id, step_index, label, started_at, ended_at, duration_ms, payload_started_json, payload_completed_json FROM steps WHERE conversation_id IN (SELECT id FROM conversations WHERE session_id = ?) ORDER BY started_at ASC').all(id);
  const canvases = db.prepare('SELECT id, session_id, path, type, created_at FROM canvases WHERE session_id = ? ORDER BY created_at ASC').all(id);
  const items = db.prepare('SELECT id, session_id, seq, kind, payload_json, created_at_ms FROM transcript_items WHERE session_id = ? ORDER BY seq ASC').all(id);
  return { session, conversations, steps, canvases, items };
}

export function listConversations(limit: number) {
  const db = getDb();
  return db.prepare('SELECT id, session_id, channel, started_at, ended_at, status, duration_ms FROM conversations ORDER BY COALESCE(ended_at, started_at) DESC LIMIT ?').all(limit);
}

export function getConversationById(id: string) {
  const db = getDb();
  const conv = db.prepare('SELECT id, session_id, channel, started_at, ended_at, status, duration_ms FROM conversations WHERE id = ?').get(id);
  if (!conv) return null;
  const steps = db.prepare('SELECT id, conversation_id, step_index, label, started_at, ended_at, duration_ms, payload_started_json, payload_completed_json FROM steps WHERE conversation_id = ? ORDER BY started_at ASC').all(id);
  return { conversation: conv, steps };
}

export function addCanvas(rec: { id: string; session_id: string; path: string; type?: string; created_at?: string; }) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO canvases (id, session_id, path, type, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(rec.id, rec.session_id, rec.path, rec.type || null, rec.created_at || new Date().toISOString());
}

export function nextSeqByConversation(conversation_id: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM transcript_items WHERE conversation_id = ?').get(conversation_id);
  return (row?.max_seq || 0) + 1;
}

export function addTranscriptItem(rec: { id?: string; conversation_id: string; kind: string; payload: any; created_at_ms?: number; }) {
  const db = getDb();
  const id = rec.id || `ti_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const seq = nextSeqByConversation(rec.conversation_id);
  const created_at_ms = rec.created_at_ms || Date.now();
  const payload_json = JSON.stringify(rec.payload ?? {});
  db.prepare('INSERT INTO transcript_items (id, conversation_id, seq, kind, payload_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, rec.conversation_id, seq, rec.kind, payload_json, created_at_ms);
  if (LEDGER_DEBUG) {
    try {
      console.debug(`[ledger] insert conv=${rec.conversation_id} id=${id} seq=${seq} kind=${rec.kind} ts=${created_at_ms}`);
    } catch {}
  }
  return { id, seq };
}

export function listTranscriptItemsByConversation(conversation_id: string) {
  const db = getDb();
  return db.prepare('SELECT id, conversation_id, seq, kind, payload_json, created_at_ms FROM transcript_items WHERE conversation_id = ? ORDER BY seq ASC').all(conversation_id);
}

export function getLastTranscriptTimestampForConversation(conversation_id: string): number | null {
  const db = getDb();
  const row = db.prepare('SELECT created_at_ms FROM transcript_items WHERE conversation_id = ? ORDER BY seq DESC LIMIT 1').get(conversation_id);
  return row?.created_at_ms ?? null;
}

export function getItemCountForSession(session_id: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(1) AS cnt FROM transcript_items ti JOIN conversations c ON ti.conversation_id = c.id WHERE c.session_id = ?').get(session_id);
  return row?.cnt || 0;
}
