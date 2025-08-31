import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface NoteData {
  id: string;
  title: string;
  content: string;
  timestamp: number;
}

const NOTES_FILE = path.join(__dirname, '..', 'notes.json');

async function readAll(): Promise<NoteData[]> {
  try {
    const file = await fs.readFile(NOTES_FILE, 'utf-8');
    const parsed = JSON.parse(file) as any[];
    // Back-compat: older notes may not have title/tags
    return parsed.map((n: any) => {
      const title: string = typeof n.title === 'string' && n.title.length > 0
        ? n.title
        : deriveTitleFromContent(String(n.content ?? ''));
      return {
        id: String(n.id),
        title,
        content: String(n.content ?? ''),
        timestamp: typeof n.timestamp === 'number' ? n.timestamp : Date.now(),
      } as NoteData;
    });
  } catch {
    return [];
  }
}

async function writeAll(notes: NoteData[]): Promise<void> {
  await fs.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf-8');
}

export async function createNote(title: string, content: string): Promise<NoteData> {
  const notes = await readAll();
  const note: NoteData = { id: randomUUID(), title, content, timestamp: Date.now() };
  notes.push(note);
  await writeAll(notes);
  return note;
}

export async function listNotes(filter?: { query?: string }): Promise<NoteData[]> {
  let notes = await readAll();
  if (filter?.query) {
    const q = filter.query.toLowerCase();
    notes = notes.filter(n =>
      n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
    );
  }
  return notes;
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
