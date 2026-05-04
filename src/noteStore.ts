import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

export interface NoteData {
  id: string;
  title: string;
  content: string;
  timestamp: number;
  /** If true, note is internal operational state (task context, etc.) and not broadcast to chat */
  internal?: boolean;
  /** If set, note should be automatically deleted after this timestamp (ms since epoch) */
  expires_at?: number;
}

// Resolve notes storage path
// Use RUNTIME_DATA_DIR when provided (e.g., in Docker/K8s), otherwise use local dev default.
const RUNTIME_DATA_DIR = process.env.RUNTIME_DATA_DIR;
const NOTES_FILE = RUNTIME_DATA_DIR
  ? path.join(RUNTIME_DATA_DIR, 'notes.json')
  : path.join(__dirname, '..', 'runtime-data', 'notes.json');

async function readAll(): Promise<NoteData[]> {
  try {
    const file = await fs.readFile(NOTES_FILE, 'utf-8');
    const parsed = JSON.parse(file) as any[];
    // Back-compat: older notes may not have title/tags/internal/expires_at
    return parsed.map((n: any) => {
      const title: string = typeof n.title === 'string' && n.title.length > 0
        ? n.title
        : deriveTitleFromContent(String(n.content ?? ''));
      const note: NoteData = {
        id: String(n.id),
        title,
        content: String(n.content ?? ''),
        timestamp: typeof n.timestamp === 'number' ? n.timestamp : Date.now(),
      };
      if (typeof n.internal === 'boolean') note.internal = n.internal;
      if (typeof n.expires_at === 'number') note.expires_at = n.expires_at;
      return note;
    });
  } catch {
    return [];
  }
}

async function writeAll(notes: NoteData[]): Promise<void> {
  const dir = path.dirname(NOTES_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await fs.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf-8');
}

export async function createNote(
  title: string,
  content: string,
  opts?: { internal?: boolean; expires_at?: number }
): Promise<NoteData> {
  const notes = await readAll();
  const note: NoteData = { id: randomUUID(), title, content, timestamp: Date.now() };
  if (opts?.internal) note.internal = true;
  if (opts?.expires_at) note.expires_at = opts.expires_at;
  notes.push(note);
  await writeAll(notes);
  return note;
}

export async function listNotes(filter?: { query?: string; includeInternal?: boolean }): Promise<NoteData[]> {
  let notes = await readAll();
  const now = Date.now();
  // Filter out expired notes and internal notes (unless explicitly requested)
  notes = notes.filter(n => {
    if (n.expires_at && n.expires_at <= now) return false; // expired
    if (n.internal && !filter?.includeInternal) return false; // internal and not requested
    return true;
  });
  if (filter?.query) {
    const q = filter.query.toLowerCase();
    notes = notes.filter(n =>
      n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
    );
  }
  return notes;
}

export async function getNote(id: string): Promise<NoteData | undefined> {
  const notes = await readAll();
  const note = notes.find(n => n.id === id);
  // Check if note is expired
  if (note && note.expires_at && note.expires_at <= Date.now()) {
    return undefined; // treat expired notes as not found
  }
  return note;
}

export async function updateNote(
  id: string,
  updates: { title?: string; content?: string }
): Promise<NoteData | undefined> {
  const notes = await readAll();
  const note = notes.find(n => n.id === id);
  if (!note) return undefined;
  if (updates.title !== undefined) note.title = updates.title;
  if (updates.content !== undefined) note.content = updates.content;
  note.timestamp = Date.now();
  await writeAll(notes);
  return note;
}

export async function deleteNote(id: string): Promise<boolean> {
  const notes = await readAll();
  const idx = notes.findIndex(n => n.id === id);
  if (idx === -1) return false;
  notes.splice(idx, 1);
  await writeAll(notes);
  return true;
}

function deriveTitleFromContent(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] || '';
  const m = /^\s*Title:\s*(.+)\s*$/i.exec(firstLine);
  const raw = m ? m[1] : firstLine;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : 'Untitled';
}

/**
 * Create an internal task note for async operations (e.g., Copilot dispatch).
 * These notes are inspectable by humans but not broadcast to chat clients by default.
 */
export async function createTaskNote(
  conversationId: string,
  taskSummary: string,
  details?: { status?: string; user_preference?: string; [key: string]: any }
): Promise<NoteData> {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours from now
  const title = `task:${conversationId}`;
  const content = [
    `Conversation: ${conversationId}`,
    `Task: ${taskSummary}`,
    `Status: ${details?.status || 'dispatched'}`,
    ...(details?.user_preference ? [`Preference: ${details.user_preference}`] : []),
    ...Object.entries(details || {})
      .filter(([k]) => !['status', 'user_preference'].includes(k))
      .map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
  return createNote(title, content, { internal: true, expires_at: expiresAt });
}
