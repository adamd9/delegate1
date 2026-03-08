import { Express, Request, Response } from 'express';
import { getMcpConfig, getMcpConfigText, writeMcpConfigText } from '../../config/mcpConfig';
import { reloadToolsAndRegistry } from '../startup/init';
import { getDiscoveryStatus } from '../../tools/mcp/adapter';

export function registerMcpConfigRoutes(app: Express) {
  app.get('/api/mcp/config', async (_req: Request, res: Response) => {
    try {
      const text = await getMcpConfigText();
      const servers = await getMcpConfig();
      const discoveryStatus = getDiscoveryStatus();
      res.json({ text, servers, discoveryStatus });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read MCP config' });
    }
  });

  app.post('/api/mcp/config', async (req: Request, res: Response) => {
    const { text } = req.body || {};
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'text field is required' });
    }
    try {
      const servers = await writeMcpConfigText(text);
      await reloadToolsAndRegistry();
      const discoveryStatus = getDiscoveryStatus();
      res.json({ status: 'updated', servers, discoveryStatus });
    } catch (err: any) {
      const message = err?.message || 'Failed to update MCP config';
      res.status(400).json({ error: message });
    }
  });
}
