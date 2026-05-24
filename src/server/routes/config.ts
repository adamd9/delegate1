import type { Application, Request, Response } from 'express';
import { configService } from '../../config';
import { runReinitsForKeys, ReinitResult } from '../../reinit/registry';

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

  app.put('/api/config', async (req: Request, res: Response) => {
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
      // Diff so we know which keys actually changed — reinit only fires for those
      const changedKeys: string[] = [];
      for (const item of validItems) {
        const previous = configService.getRaw(item.key);
        if (previous !== item.value) changedKeys.push(item.key);
        configService.set(item.key, item.value, item.sensitive);
      }

      // Trigger reinit handlers for the subsystems whose watched keys changed
      let reinit: ReinitResult[] = [];
      try {
        reinit = await runReinitsForKeys(changedKeys);
      } catch (err: any) {
        console.error('[config] reinit dispatch failed:', err?.message || err);
      }

      // Persist any updatedKeys reported by reinit handlers (e.g. resolved repo name)
      for (const result of reinit) {
        if (!result.updatedKeys) continue;
        for (const [key, value] of Object.entries(result.updatedKeys)) {
          if (isInternalKey(key)) continue;
          configService.set(key, value, false);
        }
      }

      const updatedItems = configService.getAll().filter((item) => !isInternalKey(item.key));
      res.json({ status: 'ok', items: updatedItems, reinit });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to update config' });
    }
  });

  app.delete('/api/config/:key', async (req: Request, res: Response) => {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    if (!key) {
      return res.status(400).json({ error: 'Config key is required' });
    }
    if (isInternalKey(key)) {
      return res.status(400).json({ error: 'Internal config keys cannot be deleted via API' });
    }

    try {
      const previous = configService.getRaw(key);
      configService.delete(key);
      let reinit: ReinitResult[] = [];
      if (previous !== undefined) {
        try {
          reinit = await runReinitsForKeys([key]);
        } catch (err: any) {
          console.error('[config] reinit dispatch failed:', err?.message || err);
        }
      }
      res.json({ status: 'ok', reinit });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to delete config entry' });
    }
  });
}
