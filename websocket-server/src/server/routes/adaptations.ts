import { Express, Request, Response } from 'express';
import { listAdaptations, getAdaptation, updateAdaptation, reloadAdaptations } from '../../adaptations';

export function registerAdaptationsRoutes(app: Express) {
  // List adaptations
  app.get('/api/adaptations', async (req: Request, res: Response) => {
    try {
      const agent = (req.query.agent as any) || undefined;
      const channel = (req.query.channel as any) || undefined;
      const enabled = typeof req.query.enabled === 'string' ? req.query.enabled === 'true' : undefined;
      const tags = typeof req.query.tags === 'string' ? (req.query.tags as string).split(',').map((t) => t.trim()).filter(Boolean) : undefined;
      const items = await listAdaptations({ agent, channel, enabled, tags });
      res.json({ items });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Get single adaptation
  app.get('/api/adaptations/:id', async (req: Request, res: Response) => {
    try {
      const item = await getAdaptation(req.params.id);
      if (!item) return res.status(404).json({ error: 'not_found' });
      res.json({ item });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Update adaptation (title/content/enabled)
  app.post('/api/adaptations/:id', async (req: Request, res: Response) => {
    try {
      const { title, content, enabled } = req.body || {};
      const item = await updateAdaptation(req.params.id, { title, content, enabled });
      if (!item) return res.status(404).json({ error: 'not_found' });
      res.json({ status: 'updated', item });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Reload from disk
  app.post('/api/adaptations.reload', async (_req: Request, res: Response) => {
    try {
      const result = await reloadAdaptations();
      res.json({ status: 'reloaded', ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
}
