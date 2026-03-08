import type { Application, Request, Response } from 'express';
import { getLogs } from '../../logBuffer';

export function registerLogsRoutes(app: Application) {
  // Endpoint to retrieve latest server logs
  app.get('/logs', (req: Request, res: Response) => {
    res.type('text/plain').send(getLogs().join('\n'));
  });
}
