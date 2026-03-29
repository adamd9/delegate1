import net from 'net';
import crypto from 'crypto';
import { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Token store — in-memory, 30-minute TTL
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 30 * 60 * 1000;

interface TokenEntry {
  expiresAt: number;
}

const tokenStore = new Map<string, TokenEntry>();

export function generateVncToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  tokenStore.set(token, { expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function validateVncToken(token: string): boolean {
  const entry = tokenStore.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    tokenStore.delete(token);
    return false;
  }
  return true;
}

// Cleanup expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokenStore) {
    if (now > entry.expiresAt) tokenStore.delete(token);
  }
}, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// WebSocket ↔ TCP proxy
// ---------------------------------------------------------------------------

const VNC_HOST = '127.0.0.1';
const VNC_PORT = 5900;

export function handleVncWebSocket(ws: WebSocket): void {
  const tcp = net.createConnection({ host: VNC_HOST, port: VNC_PORT }, () => {
    console.log('[vnc-proxy] connected to x11vnc');
  });

  tcp.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on('message', (data: Buffer) => {
    if (!tcp.destroyed) {
      tcp.write(data);
    }
  });

  tcp.on('error', (err: Error) => {
    console.warn('[vnc-proxy] TCP error:', err.message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'VNC connection error');
    }
  });

  tcp.on('close', () => {
    console.log('[vnc-proxy] TCP closed');
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'VNC connection closed');
    }
  });

  ws.on('close', () => {
    console.log('[vnc-proxy] WebSocket closed');
    if (!tcp.destroyed) {
      tcp.destroy();
    }
  });

  ws.on('error', (err: Error) => {
    console.warn('[vnc-proxy] WebSocket error:', err.message);
    if (!tcp.destroyed) {
      tcp.destroy();
    }
  });
}
