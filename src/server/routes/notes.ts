import type { Application, Request, Response } from 'express';
import { getNote, listNotes, createNote, updateNote, deleteNote } from '../../noteStore';
import { applySafeHtmlHeaders, renderMarkdownHtmlPage } from '../markdown';

export function registerNotesRoutes(app: Application) {
  app.get('/notes/:id', async (req: Request, res: Response) => {
    const data = await getNote((req.params as any).id);
    if (!data) {
      res.status(404).send('Not found');
      return;
    }

    applySafeHtmlHeaders(res);

    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Note';
    const content = typeof data.content === 'string' ? data.content : '';
    const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
    res.send(renderMarkdownHtmlPage({ title, content, timestamp }));
  });

  // ── REST API for notes CRUD ──

  app.get('/api/notes', async (_req: Request, res: Response) => {
    try {
      const query = typeof _req.query.q === 'string' ? _req.query.q : undefined;
      const notes = await listNotes({ query });
      res.json(notes);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to list notes' });
    }
  });

  app.get('/api/notes/:id', async (req: Request, res: Response) => {
    try {
      const note = await getNote((req.params as any).id);
      if (!note) { res.status(404).json({ error: 'not_found' }); return; }
      res.json(note);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to get note' });
    }
  });

  app.post('/api/notes', async (req: Request, res: Response) => {
    try {
      const { title, content } = req.body || {};
      if (!title || !content) { res.status(400).json({ error: 'title and content required' }); return; }
      const note = await createNote(title, content);
      res.status(201).json(note);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to create note' });
    }
  });

  app.put('/api/notes/:id', async (req: Request, res: Response) => {
    try {
      const { title, content } = req.body || {};
      const note = await updateNote((req.params as any).id, { title, content });
      if (!note) { res.status(404).json({ error: 'not_found' }); return; }
      res.json(note);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to update note' });
    }
  });

  app.delete('/api/notes/:id', async (req: Request, res: Response) => {
    try {
      const ok = await deleteNote((req.params as any).id);
      if (!ok) { res.status(404).json({ error: 'not_found' }); return; }
      res.json({ status: 'deleted' });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to delete note' });
    }
  });
}
