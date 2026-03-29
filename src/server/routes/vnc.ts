import { Router } from 'express';
import type { Application } from 'express';
import { generateVncToken } from '../../browser/vncProxy';

export function registerVncRoutes(app: Application): void {
  if (process.env.BROWSER_ENABLED !== 'true') {
    return;
  }

  const router = Router();

  // Password authentication — issues a short-lived token
  router.post('/api/vnc/auth', (req, res) => {
    const { password } = req.body || {};
    const expected = process.env.VNC_PASSWORD || 'delegate';

    if (!password || password !== expected) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    const token = generateVncToken();
    res.json({ token });
  });

  app.use(router);
}
