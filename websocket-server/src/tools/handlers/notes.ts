import { FunctionHandler } from '../../agentConfigs/types';
import { createNote, listNotes, updateNote, deleteNote } from '../../noteStore';

export const createNoteFunction: FunctionHandler = {
  schema: {
    name: 'create_note',
    type: 'function',
    description: 'Create a new note with a title and content.',
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
    return { status: 'created', note_id: note.id, title: note.title, content: note.content };
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
    // Return only id/title to keep payload small
    return { notes: notes.map(n => ({ id: n.id, title: n.title })) };
  }
};

export const updateNoteFunction: FunctionHandler = {
  schema: {
    name: 'update_note',
    type: 'function',
    description: 'Update an existing note\'s title and/or content.',
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
    return { status: 'updated', note_id: note.id, title: note.title, content: note.content };
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
    return { status: ok ? 'deleted' : 'not_found' };
  }
};
