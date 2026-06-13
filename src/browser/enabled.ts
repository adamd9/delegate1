import crypto from 'crypto';
import { configService } from '../config';

/**
 * Single source of truth for whether the browser/Copilot stack should run.
 *
 * Historically gated on a separate BROWSER_ENABLED flag. That was redundant
 * and confusing: the browser stack only exists to host Copilot, and Copilot
 * only works with a GitHub token. So presence of the token is the gate.
 *
 * An explicit BROWSER_ENABLED=false still wins as a kill switch (useful for
 * tests or temporarily disabling without removing credentials).
 */
export function isBrowserStackEnabled(): boolean {
  const explicit = configService.get('BROWSER_ENABLED');
  if (explicit === 'false') return false;
  if (explicit === 'true') return true;
  return !!(configService.get('COPILOT_GITHUB_TOKEN') || '').trim();
}

// ---------------------------------------------------------------------------
// VNC password — internal-only credential between x11vnc and our proxy.
// Users never see this; the browser client gets it via /api/vnc/auth alongside
// a short-lived session token. Generated once per process, persisted in
// memory so it survives reinit but not server restart (which is fine — clients
// re-auth on every page load).
// ---------------------------------------------------------------------------

let cachedVncPassword: string | null = null;

export function getInternalVncPassword(): string {
  if (cachedVncPassword) return cachedVncPassword;
  // Honour an explicit configured value if present (legacy installs).
  const configured = (configService.get('VNC_PASSWORD') || '').trim();
  cachedVncPassword = configured || crypto.randomBytes(6).toString('base64').slice(0, 8);
  return cachedVncPassword;
}
