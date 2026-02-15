import type { Application, Request, Response } from 'express';
import { getVoiceDefaults, saveVoiceDefaults, resetVoiceDefaults } from '../../voice/voiceDefaults';

export function registerVoiceDefaultsRoutes(app: Application) {
  // GET /voice-defaults — return current defaults for both modes
  app.get('/voice-defaults', (_req: Request, res: Response) => {
    try {
      const defaults = getVoiceDefaults();
      res.json(defaults);
    } catch (err: any) {
      console.error('[voice-defaults] GET error', err);
      res.status(500).json({ error: err?.message || 'Failed to load voice defaults' });
    }
  });

  // PUT /voice-defaults — save new defaults for both modes
  app.put('/voice-defaults', (req: Request, res: Response) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Body must be a JSON object with "normal" and "noisy" keys' });
      }
      saveVoiceDefaults(body);
      const saved = getVoiceDefaults();
      res.json({ status: 'ok', defaults: saved });
    } catch (err: any) {
      console.error('[voice-defaults] PUT error', err);
      res.status(500).json({ error: err?.message || 'Failed to save voice defaults' });
    }
  });

  // POST /voice-defaults/reset — reset to hardcoded defaults
  app.post('/voice-defaults/reset', (_req: Request, res: Response) => {
    try {
      const defaults = resetVoiceDefaults();
      res.json({ status: 'ok', defaults });
    } catch (err: any) {
      console.error('[voice-defaults] RESET error', err);
      res.status(500).json({ error: err?.message || 'Failed to reset voice defaults' });
    }
  });
}
