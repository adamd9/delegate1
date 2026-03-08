import type { Application, Request, Response } from 'express';

// Proxy route for OpenAI Realtime session token generation.
// Keeps the API key server-side; browser never sees it.
export function registerOpenAiSessionRoute(app: Application) {
  app.get('/api/session', async (_req: Request, res: Response) => {
    try {
      const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-realtime-preview-2025-06-03',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        res.status(response.status).json(data);
        return;
      }
      res.json(data);
    } catch (err: any) {
      console.error('[/api/session] Error:', err?.message || err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
}
