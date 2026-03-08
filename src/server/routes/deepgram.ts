import type { Application, Request, Response } from 'express';
import { fetch } from 'undici';

export function registerDeepgramRoutes(app: Application) {
  app.post('/deepgram/token', async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.DEEPGRAM_API_KEY || '';
      if (!apiKey) {
        res.status(500).json({ error: 'Server configuration error', message: 'DEEPGRAM_API_KEY is not set' });
        return;
      }

      const ttlSecondsRaw = (req.body as any)?.ttl_seconds;
      const ttlSeconds = typeof ttlSecondsRaw === 'number' ? ttlSecondsRaw : undefined;

      const dgResp = await fetch('https://api.deepgram.com/v1/auth/grant', {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: ttlSeconds ? JSON.stringify({ ttl_seconds: ttlSeconds }) : undefined,
      });

      if (!dgResp.ok) {
        const text = await dgResp.text().catch(() => '');
        res.status(502).json({ error: 'Deepgram error', status: dgResp.status, message: text || dgResp.statusText });
        return;
      }

      const data = (await dgResp.json()) as any;
      res.json({ access_token: data?.access_token, expires_in: data?.expires_in });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to mint token', message: e?.message || String(e) });
    }
  });
}
