import type { Application, Request, Response } from 'express';
import cors from 'cors';
import { getThoughtflowArtifact, listThoughtflowArtifacts } from '../../db/sqlite';

export function registerThoughtflowRoutes(app: Application) {
  // Allow webapp (different origin) to fetch artifacts
  app.use('/thoughtflow', cors());

  // ThoughtFlow D2 raw route: force text/plain inline for immediate viewing
  app.get('/thoughtflow/raw/:id.d2', (req: Request, res: Response) => {
    try {
      const id = (req.params as any).id as string;
      const artifact = getThoughtflowArtifact(id, 'd2');
      if (!artifact) {
        try { console.warn(`[thoughtflow] raw d2 404: id=${id}`); } catch {}
        res.status(404).send('Not found');
        return;
      }
      try { console.debug(`[thoughtflow] raw d2 read OK: ${id}`); } catch {}
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline');
      res.send(artifact.content || '');
    } catch (e: any) {
      try { console.warn(`[thoughtflow] raw d2 404: id=${(req.params as any).id}`); } catch {}
      res.status(404).send('Not found');
    }
  });

  app.get('/thoughtflow/:id.:ext', (req: Request, res: Response) => {
    const { id, ext } = req.params as any;
    if (!id || !ext) {
      res.status(400).send('Bad request');
      return;
    }
    const normalizedExt = String(ext).toLowerCase();
    if (normalizedExt !== 'json' && normalizedExt !== 'd2') {
      res.status(404).send('Not found');
      return;
    }
    const artifact = getThoughtflowArtifact(id, normalizedExt as any);
    if (!artifact) {
      try { console.warn(`[thoughtflow] artifact miss id=${id} ext=${normalizedExt}`); } catch {}
      res.status(404).send('Not found');
      return;
    }
    if (normalizedExt === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    } else {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.send(artifact.content || '');
  });

  // Diagnostics: list available artifacts (json/d2/jsonl) to confirm server path resolution
  app.get('/thoughtflow/debug/list', (req: Request, res: Response) => {
    try {
      const rows = listThoughtflowArtifacts();
      res.json({ count: rows.length, artifacts: rows });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
}
