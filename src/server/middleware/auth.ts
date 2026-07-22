import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { configService } from '../../config';

const INSTALL_PUBLIC_PATHS = new Set([
  '/install',
  '/install.html',
  '/api/install',
  '/auth/status',
  '/health',
  '/ready',
  '/build-info.json',
  '/public-url',
  '/twiml',
  '/sms',
  '/api/copilot/callback',
]);

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.authenticated === true) {
    next();
    return;
  }

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Preserve the originally-requested URL (GET navigations only) so /login can
  // send the user back to their deep link after signing in. Only a same-origin
  // relative path is carried; login.html re-validates it before redirecting
  // (open-redirect guard).
  const target = req.method === 'GET' ? req.originalUrl : '';
  if (target && target !== '/' && !target.startsWith('/login')) {
    res.redirect('/login?returnTo=' + encodeURIComponent(target));
    return;
  }

  res.redirect('/login');
}

export function isConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD) || configService.has('admin_password_hash');
}

export async function validatePassword(password: string): Promise<boolean> {
  const envPassword = process.env.ADMIN_PASSWORD;
  if (envPassword) {
    // Timing-safe comparison for env-based password
    const a = Buffer.from(password);
    const b = Buffer.from(envPassword);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  const passwordHash = configService.getRaw('admin_password_hash');
  if (!passwordHash) {
    return false;
  }

  return bcrypt.compare(password, passwordHash);
}

export function installGuard(req: Request, res: Response, next: NextFunction) {
  if (isConfigured()) {
    next();
    return;
  }

  if (INSTALL_PUBLIC_PATHS.has(req.path) || req.path.startsWith('/_dev/walkie')) {
    next();
    return;
  }

  res.redirect('/install');
}
