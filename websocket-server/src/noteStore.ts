import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface NoteData {
  id: string;
  content: string;
  tags?: string[];
  timestamp: number;
}

const NOTES_FILE = path.join(__dirname, '..', 'notes.json');

async function readAll(): Promise<NoteData[]> {
  try {
    const file = await fs.readFile(NOTES_FILE, 'utf-8');
    return JSON.parse(file) as NoteData[];
  } catch {
    return [];
  }
}

async function writeAll(notes: NoteData[]): Promise<void> {
  await fs.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf-8');
}

export async function createNote(content: string, tags: string[] = []): Promise<NoteData> {
  const notes = await readAll();
  const note: NoteData = { id: randomUUID(), content, tags, timestamp: Date.now() };
  notes.push(note);
  await writeAll(notes);
  return note;
}

export async function listNotes(filter?: { tag?: string; query?: string }): Promise<NoteData[]> {
  let notes = await readAll();
  if (filter?.tag) {
    const tag = filter.tag;
    notes = notes.filter(n => n.tags?.includes(tag));
  }
  if (filter?.query) {
    const q = filter.query.toLowerCase();
    notes = notes.filter(n => n.content.toLowerCase().includes(q));
  }
  return notes;
}

export async function updateNote(id: string, content?: string, tags?: string[]): Promise<NoteData | undefined> {
  const notes = await readAll();
  const note = notes.find(n => n.id === id);
  if (!note) return undefined;
  if (content !== undefined) note.content = content;
  if (tags !== undefined) note.tags = tags;
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

export async function listCategories(): Promise<string[]> {
  const notes = await readAll();
  const set = new Set<string>();
  for (const n of notes) {
    if (n.tags) for (const t of n.tags) set.add(t);
  }
  return Array.from(set);
}
