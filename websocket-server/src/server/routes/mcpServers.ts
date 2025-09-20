import type { Application, Request, Response } from 'express';
import {
  listMcpServers,
  getMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  type McpServerInput,
  type McpServerUpdate,
} from '../../mcpServers';
import { initMCPDiscovery } from '../../tools/mcp/adapter';
import { registerMcpTools } from '../../tools/providers/mcp';

function handleError(res: Response, err: any, defaultMessage: string, status = 500) {
  const message = err?.message && typeof err.message === 'string' ? err.message : defaultMessage;
  res.status(status).json({ error: message });
}

export function registerMcpServersRoutes(app: Application) {
  app.get('/api/mcp-servers', async (_req: Request, res: Response) => {
    try {
      const items = await listMcpServers();
      res.json({ items });
    } catch (err) {
      handleError(res, err, 'Failed to list MCP servers');
    }
  });

  app.get('/api/mcp-servers/:id', async (req: Request, res: Response) => {
    try {
      const item = await getMcpServer(req.params.id);
      if (!item) {
        res.status(404).json({ error: 'MCP server not found' });
        return;
      }
      res.json({ item });
    } catch (err) {
      handleError(res, err, 'Failed to fetch MCP server');
    }
  });

  app.post('/api/mcp-servers', async (req: Request, res: Response) => {
    try {
      const payload = req.body as McpServerInput | undefined;
      const item = await createMcpServer(payload || ({} as any));
      res.json({ item });
    } catch (err: any) {
      const status = err?.message && /(required|unsupported|invalid)/i.test(err.message) ? 400 : 500;
      handleError(res, err, 'Failed to create MCP server', status);
    }
  });

  app.post('/api/mcp-servers/:id', async (req: Request, res: Response) => {
    try {
      const payload = req.body as McpServerUpdate | undefined;
      const item = await updateMcpServer(req.params.id, payload || {});
      if (!item) {
        res.status(404).json({ error: 'MCP server not found' });
        return;
      }
      res.json({ item });
    } catch (err: any) {
      const status = err?.message && /(required|unsupported|invalid)/i.test(err.message) ? 400 : 500;
      handleError(res, err, 'Failed to update MCP server', status);
    }
  });

  app.delete('/api/mcp-servers/:id', async (req: Request, res: Response) => {
    try {
      const removed = await deleteMcpServer(req.params.id);
      if (!removed) {
        res.status(404).json({ error: 'MCP server not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err, 'Failed to delete MCP server');
    }
  });

  app.post('/api/mcp-servers.reload', async (_req: Request, res: Response) => {
    try {
      const summary = await initMCPDiscovery();
      registerMcpTools();
      res.json({ ok: true, summary });
    } catch (err) {
      handleError(res, err, 'Failed to reload MCP servers');
    }
  });
}
