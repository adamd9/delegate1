import type { Application, Request, Response } from 'express';
import { listAllTools, getAgentsDebug, getSchemasForAgent, updateAgentPolicy } from '../../tools/registry';
import type { AgentPolicy } from '../../tools/registry';
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

  app.patch('/agents/:id/policy', (req: Request, res: Response) => {
    const id = (req.params as any).id;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'Agent id is required' });
      return;
    }

    const { allowNames, allowTags } = req.body ?? {};
    const updates: Partial<AgentPolicy> = {};

    if (allowNames !== undefined) {
      if (!Array.isArray(allowNames) || !allowNames.every((name) => typeof name === 'string')) {
        res.status(400).json({ error: 'allowNames must be an array of strings' });
        return;
      }
      updates.allowNames = allowNames as string[];
    }

    if (allowTags !== undefined) {
      if (!Array.isArray(allowTags) || !allowTags.every((tag) => typeof tag === 'string')) {
        res.status(400).json({ error: 'allowTags must be an array of strings' });
        return;
      }
      updates.allowTags = allowTags as string[];
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: 'No valid policy fields provided' });
      return;
    }

    try {
      const policy = updateAgentPolicy(id, updates);
      res.json({
        status: 'updated',
        agent: {
          policy,
          tools: (getSchemasForAgent(id) || []).map((s: any) => (s.type === 'function' ? s.name : s.type)),
        },
      });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Failed to update agent policy' });
    }
  });
}
