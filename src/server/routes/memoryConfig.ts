import type { Application, Request, Response } from 'express';
import { getMemoryConfig, saveMemoryConfig } from '../../memory/memoryConfig';

export function registerMemoryConfigRoutes(app: Application) {
  app.get('/memory-config', (_req: Request, res: Response) => {
    try {
      res.json(getMemoryConfig());
    } catch (err: any) {
      console.error('[memory-config] GET error', err);
      res.status(500).json({ error: err?.message || 'Failed to load memory config' });
    }
  });

  app.put('/memory-config', (req: Request, res: Response) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Body must be a JSON object' });
      }
      const saved = saveMemoryConfig(body);
      res.json({ status: 'ok', config: saved });
    } catch (err: any) {
      console.error('[memory-config] PUT error', err);
      res.status(500).json({ error: err?.message || 'Failed to save memory config' });
    }
  });
}
