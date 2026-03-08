import type { Application, Request, Response } from 'express';

// Simple in-memory readiness flags; controlled by server.ts
let _ready = false;
let _healthy = true;

export function setReady(v: boolean) { _ready = v; }
export function setHealthy(v: boolean) { _healthy = v; }

export function registerHealthRoutes(app: Application) {
  app.get('/health', (req: Request, res: Response) => {
    // Liveness: if the process is up, we’re healthy unless flagged otherwise
    res.json({ status: _healthy ? 'ok' : 'degraded' });
  });

  app.get('/ready', (req: Request, res: Response) => {
    // Readiness: only OK when startup tasks done and server is listening
    if (_ready) return res.json({ status: 'ok' });
    res.status(503).json({ status: 'starting' });
  });
}
