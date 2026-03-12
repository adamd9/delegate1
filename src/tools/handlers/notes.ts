import { FunctionHandler } from '../../agentConfigs/types';
import { createNote, listNotes, updateNote, deleteNote, getNote } from '../../noteStore';
import { session, jsonSend, type ConversationItem } from '../../session/state';
import { chatClients } from '../../ws/clients';
import { ensureSession } from '../../observability/thoughtflow';
import { addConversationEvent } from '../../db/sqlite';

const PUBLIC_URL = process.env.PUBLIC_URL || '';
const DEFAULT_PORT = process.env.PORT || '8081';
const EFFECTIVE_PUBLIC_URL = (PUBLIC_URL && PUBLIC_URL.trim()) || `http://localhost:${DEFAULT_PORT}`;

function buildNoteUrl(noteId: string): string {
  const base = EFFECTIVE_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/notes/${noteId}`;
}

function broadcastToClients(message: object) {
  for (const client of chatClients) {
    jsonSend(client, message);
  }
}

function recordConversationEvent(kind: string, payload: object) {
  try {
    ensureSession();
    const req = session.currentRequest;
    const runId = req ? `run_${req.id}` : undefined;
    if (runId) {
      addConversationEvent({
        conversation_id: runId,
        kind,
        payload,
        created_at_ms: Date.now(),
      });
    }
  } catch {}
}

export const createNoteFunction: FunctionHandler = {
  schema: {
    name: 'create_note',
    type: 'function',
    description: 'Create a new note with a title and content. Returns a publicly accessible link to the note. Use this to share detailed content, research results, or anything too long for a voice/chat response.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['title', 'content'],
      additionalProperties: false
    }
  },
  handler: async ({ title, content }: { title: string; content: string }) => {
    const note = await createNote(title, content);
    const url = buildNoteUrl(note.id);

    const message = { type: 'chat.note', id: note.id, url, title: note.title, timestamp: note.timestamp };
    broadcastToClients(message);

    const entry: ConversationItem = {
      type: 'note',
      content: url,
      title: note.title,
      timestamp: note.timestamp,
      id: note.id,
    };
    if (!session.conversationHistory) session.conversationHistory = [];
    session.conversationHistory.push(entry);

    recordConversationEvent('note_created', { id: note.id, title: note.title, url });

    return { status: 'created', note_id: note.id, title: note.title, url };
  }
};

export const listNotesFunction: FunctionHandler = {
  schema: {
    name: 'list_notes',
    type: 'function',
    description: 'List note titles, optionally filtered by a search query (matches title or content).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full text search within note title/content.' }
      },
      required: [],
      additionalProperties: false
    }
  },
  handler: async ({ query }: { query?: string }) => {
    const notes = await listNotes({ query });
    return { notes: notes.map(n => ({ id: n.id, title: n.title, url: buildNoteUrl(n.id) })) };
  }
};

export const updateNoteFunction: FunctionHandler = {
  schema: {
    name: 'update_note',
    type: 'function',
    description: 'Update an existing note\'s title and/or content. The note\'s public URL stays the same and will reflect the updated content.',
    parameters: {
      type: 'object',
      properties: {
        note_id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['note_id'],
      additionalProperties: false
    }
  },
  handler: async ({ note_id, title, content }: { note_id: string; title?: string; content?: string }) => {
    const note = await updateNote(note_id, { title, content });
    if (!note) return { error: 'not_found' };
    const url = buildNoteUrl(note.id);

    broadcastToClients({ type: 'chat.note.updated', id: note.id, title: note.title, url, timestamp: note.timestamp });
    recordConversationEvent('note_updated', { id: note.id, title: note.title, url });

    return { status: 'updated', note_id: note.id, title: note.title, url };
  }
};

export const deleteNoteFunction: FunctionHandler = {
  schema: {
    name: 'delete_note',
    type: 'function',
    description: 'Delete a note by its identifier.',
    parameters: {
      type: 'object',
      properties: {
        note_id: { type: 'string' }
      },
      required: ['note_id'],
      additionalProperties: false
    }
  },
  handler: async ({ note_id }: { note_id: string }) => {
    const ok = await deleteNote(note_id);
    if (ok) {
      broadcastToClients({ type: 'chat.note.deleted', id: note_id, timestamp: Date.now() });
      recordConversationEvent('note_deleted', { id: note_id });
    }
    return { status: ok ? 'deleted' : 'not_found' };
  }
};

export const getNoteFunction: FunctionHandler = {
  schema: {
    name: 'get_note',
    type: 'function',
    description: 'Get or read a note by its identifier, including its content.',
    parameters: {
      type: 'object',
      properties: {
        note_id: { type: 'string' }
      },
      required: ['note_id'],
      additionalProperties: false
    }
  },
  handler: async ({ note_id }: { note_id: string }) => {
    const note = await getNote(note_id);
    if (!note) return { error: 'not_found' };
    return { note: { ...note, url: buildNoteUrl(note.id) } };
  }
};
