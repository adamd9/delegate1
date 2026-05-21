import type { Application, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { configService } from '../../config';
import { isConfigured, requireAuth, validatePassword } from '../middleware/auth';

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

function getPassword(body: unknown): string | undefined {
  const password = (body as { password?: unknown } | undefined)?.password;
  return typeof password === 'string' ? password : undefined;
}

export function registerAuthRoutes(app: Application) {
  app.post('/login', async (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const attempts = loginAttempts.get(ip);
    if (attempts && attempts.count >= MAX_ATTEMPTS && Date.now() - attempts.lastAttempt < LOCKOUT_MS) {
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }

    const password = getPassword(req.body);
    if (!password || !(await validatePassword(password))) {
      const current = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
      loginAttempts.set(ip, { count: current.count + 1, lastAttempt: Date.now() });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    loginAttempts.delete(ip);

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        res.status(500).json({ error: 'Failed to create session' });
        return;
      }
      req.session.authenticated = true;
      req.session.save((saveErr) => {
        if (saveErr) {
          res.status(500).json({ error: 'Failed to save session' });
          return;
        }
        res.json({ status: 'ok' });
      });
    });
  });

  app.post('/logout', (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ error: 'Failed to destroy session' });
        return;
      }
      res.json({ status: 'ok' });
    });
  });

  app.get('/auth/status', (req: Request, res: Response) => {
    res.json({
      configured: isConfigured(),
      authenticated: req.session.authenticated === true,
    });
  });

  app.post('/api/auth/password', requireAuth, async (req: Request, res: Response) => {
    const password = getPassword(req.body);
    if (!password) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    configService.set('admin_password_hash', passwordHash, true);
    res.json({ status: 'ok' });
  });

  app.post('/api/install', async (req: Request, res: Response) => {
    if (isConfigured()) {
      res.status(409).json({ error: 'Already configured' });
      return;
    }

    const password = getPassword(req.body);
    if (!password) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Atomic check-and-set: only succeeds if not already configured
    if (configService.has('admin_password_hash')) {
      res.status(409).json({ error: 'Already configured' });
      return;
    }
    configService.set('admin_password_hash', passwordHash, true);
    res.json({ status: 'ok' });
  });
}
