/**
 * Copilot Tasks — DB access layer.
 *
 * A "task" is a 1:1:1 binding of:
 *   - a row in the copilot_tasks table
 *   - a Copilot CLI session UUID (lives under COPILOT_HOME/session-state/<UUID>/)
 *   - an isolated subfolder runtime-data/copilot-workdir/tasks/<task-id>/
 *
 * This module is pure data access. Process management + queueing lives in taskRunner.ts.
 */

import { getDb } from '../db/sqlite';

export type TaskStatus =
  | 'running'
  | 'awaiting_user'
  | 'completed'
  | 'failed'
  | 'idle'
  | 'archived';

export interface CopilotTaskRow {
  id: string;
  copilot_session_id: string | null;
  title: string;
  status: TaskStatus;
  workdir: string;
  originating_conversation_id: string | null;
  created_at_ms: number;
  last_active_at_ms: number;
  ended_at_ms: number | null;
  last_prompt: string | null;
  last_summary: string | null;
  needs_user_reason: string | null;
  turn_count: number;
  archived: number;
  meta_json: string | null;
}

export type EventKind =
  | 'user_prompt'
  | 'agent_output'
  | 'agent_stderr'
  | 'system'
  | 'needs_user'
  | 'turn_start'
  | 'turn_end'
  | 'cancelled'
  | 'git_sync';

export interface CopilotTaskEvent {
  id: number;
  task_id: string;
  created_at_ms: number;
  kind: EventKind;
  payload: any;
}

/** Generate a short, human-readable, URL-safe task id, e.g. `c4f-coles-shopping`. */
export function generateTaskId(title: string): string {
  const slug = (title || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '') || 'task';
  const rand = Math.random().toString(36).slice(2, 5);
  return `${rand}-${slug}`;
}

/** Derive a sensible title from a prompt when the caller hasn't provided one. */
export function autoTitleFromPrompt(prompt: string, maxLen = 80): string {
  const firstLine = (prompt || '').split('\n')[0].trim();
  if (!firstLine) return 'Untitled task';
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 1) + '…';
}

export function insertTask(row: {
  id: string;
  title: string;
  status: TaskStatus;
  workdir: string;
  originating_conversation_id?: string | null;
  meta?: any;
}): CopilotTaskRow {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO copilot_tasks (
      id, copilot_session_id, title, status, workdir,
      originating_conversation_id, created_at_ms, last_active_at_ms,
      ended_at_ms, last_prompt, last_summary, needs_user_reason,
      turn_count, archived, meta_json
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, ?)`
  ).run(
    row.id,
    row.title,
    row.status,
    row.workdir,
    row.originating_conversation_id ?? null,
    now,
    now,
    row.meta ? JSON.stringify(row.meta) : null
  );
  return getTask(row.id)!;
}

export function getTask(id: string): CopilotTaskRow | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM copilot_tasks WHERE id = ?').get(id) as CopilotTaskRow) || null;
}

export function findTaskByName(query: string): CopilotTaskRow | null {
  const db = getDb();
  // Exact id match wins
  const byId = getTask(query);
  if (byId) return byId;
  // Then title match — case-insensitive, most recent first, excluding archived
  const rows = db.prepare(
    `SELECT * FROM copilot_tasks
     WHERE archived = 0 AND (LOWER(title) LIKE ? OR id LIKE ?)
     ORDER BY last_active_at_ms DESC
     LIMIT 1`
  ).all(`%${query.toLowerCase()}%`, `%${query}%`) as CopilotTaskRow[];
  return rows[0] || null;
}

export function listTasks(opts: {
  includeArchived?: boolean;
  statuses?: TaskStatus[];
  limit?: number;
} = {}): CopilotTaskRow[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (!opts.includeArchived) where.push('archived = 0');
  if (opts.statuses && opts.statuses.length > 0) {
    where.push(`status IN (${opts.statuses.map(() => '?').join(',')})`);
    params.push(...opts.statuses);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limitSql = opts.limit ? 'LIMIT ' + Math.max(1, Math.floor(opts.limit)) : '';
  return db.prepare(
    `SELECT * FROM copilot_tasks ${whereSql} ORDER BY last_active_at_ms DESC ${limitSql}`
  ).all(...params) as CopilotTaskRow[];
}

export function updateTask(id: string, patch: Partial<{
  copilot_session_id: string | null;
  title: string;
  status: TaskStatus;
  last_prompt: string | null;
  last_summary: string | null;
  needs_user_reason: string | null;
  ended_at_ms: number | null;
  archived: 0 | 1;
  meta: any;
}>): CopilotTaskRow | null {
  const db = getDb();
  const sets: string[] = ['last_active_at_ms = ?'];
  const vals: any[] = [Date.now()];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'meta') {
      sets.push('meta_json = ?');
      vals.push(v === null ? null : JSON.stringify(v));
    } else {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  vals.push(id);
  db.prepare(`UPDATE copilot_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getTask(id);
}

export function incrementTurnCount(id: string): void {
  const db = getDb();
  db.prepare('UPDATE copilot_tasks SET turn_count = turn_count + 1, last_active_at_ms = ? WHERE id = ?')
    .run(Date.now(), id);
}

export function addEvent(rec: { task_id: string; kind: EventKind; payload?: any }): CopilotTaskEvent {
  const db = getDb();
  const now = Date.now();
  const payload = rec.payload ?? {};
  const result = db.prepare(
    `INSERT INTO copilot_task_events (task_id, created_at_ms, kind, payload_json) VALUES (?, ?, ?, ?)`
  ).run(rec.task_id, now, rec.kind, JSON.stringify(payload));
  return {
    id: Number(result.lastInsertRowid),
    task_id: rec.task_id,
    created_at_ms: now,
    kind: rec.kind,
    payload,
  };
}

export function listEvents(task_id: string, opts: { afterId?: number; limit?: number } = {}): CopilotTaskEvent[] {
  const db = getDb();
  const params: any[] = [task_id];
  let sql = 'SELECT * FROM copilot_task_events WHERE task_id = ?';
  if (opts.afterId != null) {
    sql += ' AND id > ?';
    params.push(opts.afterId);
  }
  sql += ' ORDER BY id ASC';
  if (opts.limit) {
    sql += ' LIMIT ?';
    params.push(Math.max(1, Math.floor(opts.limit)));
  }
  const rows = db.prepare(sql).all(...params) as Array<Omit<CopilotTaskEvent, 'payload'> & { payload_json: string }>;
  return rows.map(r => ({
    id: r.id,
    task_id: r.task_id,
    created_at_ms: r.created_at_ms,
    kind: r.kind,
    payload: (() => { try { return JSON.parse(r.payload_json); } catch { return {}; } })(),
  }));
}

/**
 * Lightweight task summary for the chat agent (copilot_task_status tool).
 * Last N output events compacted to a string.
 */
export function summarizeTask(id: string, opts: { tailChars?: number } = {}): {
  task: CopilotTaskRow;
  recentOutput: string;
  recentEvents: CopilotTaskEvent[];
} | null {
  const task = getTask(id);
  if (!task) return null;
  const all = listEvents(id);
  const recent = all.slice(-40);
  const outputChunks: string[] = [];
  for (const ev of all.slice(-100)) {
    if (ev.kind === 'agent_output' && typeof ev.payload?.text === 'string') {
      outputChunks.push(ev.payload.text);
    }
  }
  let recentOutput = outputChunks.join('');
  const tailChars = opts.tailChars ?? 4000;
  if (recentOutput.length > tailChars) recentOutput = '…' + recentOutput.slice(-tailChars);
  return { task, recentOutput, recentEvents: recent };
}
