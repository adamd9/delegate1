import type { Application, Request, Response } from 'express';
import { listAllTools, getAgentsDebug, getSchemasForAgent } from '../../tools/registry';
import functions from '../../functionHandlers';

export function registerCatalogRoutes(app: Application) {
  // Back-compat simple tools list
  app.get('/tools', (req: Request, res: Response) => {
    res.json(functions.map((f) => f.schema));
  });

  // Central catalog debug endpoint: canonical tools with metadata
  app.get('/catalog/tools', (req: Request, res: Response) => {
    const catalog = listAllTools().map(t => ({
      id: t.id,
      name: t.name,
      sanitizedName: t.sanitizedName,
      origin: t.origin,
      tags: t.tags,
      description: t.description,
    }));
    res.json(catalog);
  });

  // Agents debug endpoint: policies and resolved tool names
  app.get('/agents', (req: Request, res: Response) => {
    res.json(getAgentsDebug());
  });

  // Tools visible to a given agent (Responses API tools array)
  app.get('/agents/:id/tools', (req: Request, res: Response) => {
    const id = (req.params as any).id;
    try {
      const schemas = getSchemasForAgent(id);
      res.json(schemas);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Failed to get tools for agent' });
    }
  });
}
