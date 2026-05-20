import type { Application, Request, Response } from 'express';
import { configService } from '../../config';

interface ConfigPayloadItem {
  key: string;
  value: string;
  sensitive?: boolean;
}

function isInternalKey(key: string): boolean {
  return key.startsWith('_');
}

function isValidItem(item: unknown): item is ConfigPayloadItem {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  if (typeof record.key !== 'string' || typeof record.value !== 'string') return false;
  return record.sensitive === undefined || typeof record.sensitive === 'boolean';
}

export function registerConfigRoutes(app: Application) {
  app.get('/api/config', (_req: Request, res: Response) => {
    try {
      const items = configService.getAll().filter((item) => !isInternalKey(item.key));
      res.json({ items });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load config' });
    }
  });

  app.put('/api/config', (req: Request, res: Response) => {
    const body = req.body;
    const items = Array.isArray(body?.items) ? body.items : [body];

    if (!items.every(isValidItem)) {
      return res.status(400).json({ error: 'Body must contain a valid config item or items array' });
    }

    const validItems = items as ConfigPayloadItem[];
    if (validItems.some((item: ConfigPayloadItem) => isInternalKey(item.key))) {
      return res.status(400).json({ error: 'Internal config keys cannot be modified via API' });
    }

    try {
      for (const item of validItems) {
        configService.set(item.key, item.value, item.sensitive);
      }
      const updatedItems = configService.getAll().filter((item) => !isInternalKey(item.key));
      res.json({ status: 'ok', items: updatedItems });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to update config' });
    }
  });

  app.delete('/api/config/:key', (req: Request, res: Response) => {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    if (!key) {
      return res.status(400).json({ error: 'Config key is required' });
    }
    if (isInternalKey(key)) {
      return res.status(400).json({ error: 'Internal config keys cannot be deleted via API' });
    }

    try {
      configService.delete(key);
      res.json({ status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to delete config entry' });
    }
  });
}
