import { FunctionHandler } from '../../agentConfigs/types';
import { createNote, listNotes, updateNote, deleteNote, listCategories } from '../../noteStore';

export const createNoteFunction: FunctionHandler = {
  schema: {
    name: 'create_note',
    type: 'function',
    description: 'Create a new note with optional tags for categorization.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['content'],
      additionalProperties: false
    }
  },
  handler: async ({ content, tags }: { content: string; tags?: string[] }) => {
    const note = await createNote(content, Array.isArray(tags) ? tags : []);
    return { status: 'created', note_id: note.id, content: note.content, tags: note.tags ?? [] };
  }
};

export const listNotesFunction: FunctionHandler = {
  schema: {
    name: 'list_notes',
    type: 'function',
    description: 'List existing notes, optionally filtered by tag or search query.',
    parameters: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Return only notes with this tag.' },
        query: { type: 'string', description: 'Full text search within note content.' }
      },
      required: [],
      additionalProperties: false
    }
  },
  handler: async ({ tag, query }: { tag?: string; query?: string }) => {
    const notes = await listNotes({ tag, query });
    return { notes };
  }
};

export const updateNoteFunction: FunctionHandler = {
  schema: {
    name: 'update_note',
    type: 'function',
    description: 'Update an existing note\'s content or tags.',
    parameters: {
      type: 'object',
      properties: {
        note_id: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['note_id'],
      additionalProperties: false
    }
  },
  handler: async ({ note_id, content, tags }: { note_id: string; content?: string; tags?: string[] }) => {
    const note = await updateNote(note_id, content, tags);
    if (!note) return { error: 'not_found' };
    return { status: 'updated', note_id: note.id, content: note.content, tags: note.tags ?? [] };
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

export const listCategoriesFunction: FunctionHandler = {
  schema: {
    name: 'list_categories',
    type: 'function',
    description: 'List all unique tags used across notes.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  handler: async () => {
    const categories = await listCategories();
    return { categories };
  }
};
