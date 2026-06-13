import { Router } from 'express';
import type { Application } from 'express';
import { generateVncToken } from '../../browser/vncProxy';
import { getBrowserStatus, reinitBrowserInfra } from '../../browser';
import { isBrowserStackEnabled, getInternalVncPassword } from '../../browser/enabled';
import net from 'net';

function canConnectToVncPort(timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 5900 });

    const finish = (ok: boolean) => {
      try { socket.destroy(); } catch (_) {}
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export function registerVncRoutes(app: Application): void {
  const router = Router();

  // Session-authenticated route — issues a short-lived token and VNC credential.
  // The app-level auth middleware already protects this route.
  router.post('/api/vnc/auth', async (_req, res) => {
    // If Copilot isn't configured at all, surface a clear, actionable error.
    if (!isBrowserStackEnabled()) {
      res.status(503).json({
        error: 'VNC is not available: Copilot is not configured. Add your COPILOT_GITHUB_TOKEN in Settings → Browser / Copilot to enable the live browser pane.',
        details: { enabled: false, running: false, dockerMode: false },
      });
      return;
    }

    // Guard against stale or local-dev states where VNC token auth succeeds
    // but the VNC proxy has no upstream x11vnc to connect to.
    let vncReachable = await canConnectToVncPort();
    if (!vncReachable) {
      await reinitBrowserInfra();
      vncReachable = await canConnectToVncPort();
    }

    if (!vncReachable) {
      const status = getBrowserStatus();
      const localHint = !status.dockerMode
        ? 'Local dev mode does not provide VNC display services by default. Use Docker/browser runtime for VNC.'
        : 'VNC display services are not reachable on port 5900.';
      res.status(503).json({
        error: localHint,
        details: {
          enabled: status.enabled,
          running: status.running,
          dockerMode: status.dockerMode,
        },
      });
      return;
    }

    const token = generateVncToken();
    const password = getInternalVncPassword();
    res.json({ token, password });
  });

  app.use(router);
}
