import type { Application, Request, Response } from 'express';
import express from 'express';
import cors from 'cors';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export function registerThoughtflowRoutes(app: Application) {
  // Allow webapp (different origin) to fetch artifacts
  app.use('/thoughtflow', cors());

  // Resolve artifacts directory relative to project root so it works in both ts-node and dist
  // From src: __dirname = src/server/routes -> ../../.. = project root
  // From dist: __dirname = dist/server/routes -> ../../.. = project root
  const BASE_DIR = join(__dirname, '..', '..', '..', 'runtime-data', 'thoughtflow');

  // ThoughtFlow D2 raw route: force text/plain inline for immediate viewing
  app.get('/thoughtflow/raw/:id.d2', (req: Request, res: Response) => {
    try {
      const id = (req.params as any).id as string;
      const filePath = join(BASE_DIR, `${id}.d2`);
      const content = readFileSync(filePath, 'utf8');
      try { console.debug(`[thoughtflow] raw d2 read OK: ${filePath}`); } catch {}
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline');
      res.send(content);
    } catch (e: any) {
      try { console.warn(`[thoughtflow] raw d2 404: id=${(req.params as any).id}`); } catch {}
      res.status(404).send('Not found');
    }
  });

  // Serve ThoughtFlow artifacts (JSON, D2) so the webapp can link to them
  // Serve artifacts from websocket-server/runtime-data/thoughtflow (matches writer in observability/thoughtflow.ts under ts-node)
  app.use('/thoughtflow', express.static(BASE_DIR));

  // Diagnostics: list available artifacts (json/d2/jsonl) to confirm server path resolution
  app.get('/thoughtflow/debug/list', (req: Request, res: Response) => {
    try {
      const files = readdirSync(BASE_DIR);
      res.json({ dir: BASE_DIR, files });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
}
