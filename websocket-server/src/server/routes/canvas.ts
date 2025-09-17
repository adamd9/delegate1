import type { Application, Request, Response } from 'express';
import { marked } from 'marked';
import { getCanvas } from '../../canvasStore';

export function registerCanvasRoutes(app: Application) {
  // Endpoint to serve stored canvas content as HTML
  app.get('/canvas/:id', async (req: Request, res: Response) => {
    const data = await getCanvas((req.params as any).id);
    if (!data) {
      res.status(404).send('Not found');
      return;
    }
    const html = marked.parse((data as any).content ?? '');
    res.send(`<!doctype html><html><head><title>${(data as any).title || 'Canvas'}</title></head><body>${html}</body></html>`);
  });
}
