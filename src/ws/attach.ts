import { WebSocketServer, WebSocket } from 'ws';
import type http from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import type { Duplex } from 'stream';
import type { RequestHandler } from 'express';
import { establishCallSocket } from '../session/call';
import { establishBrowserCallSocket } from '../session/browserCall';
import { establishChatSocket } from '../session/chat';
import { establishDeepgramProxy } from './deepgramProxy';
import { session, isOpen, jsonSend } from '../session/state';
import { setCopilotBroadcast, getActiveSession } from '../tools/handlers/copilotCli';
import { handleVncWebSocket, validateVncToken } from '../browser/vncProxy';

/**
 * Attaches a WebSocketServer to the given HTTP server and wires up
 * handlers for `wss://.../call`, `wss://.../browser-call`, and `wss://.../chat` paths.
 *
 * logs websocket is decommissioned; it is treated as closed.
 */
type SessionRequest = IncomingMessage & {
  session?: {
    authenticated?: boolean;
  };
};

function isProtectedWebSocketPath(type: string): boolean {
  return type === 'chat' || type === 'browser-call' || type === 'deepgram' || type === 'copilot';
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function loadSession(req: IncomingMessage, sessionMiddleware: RequestHandler): Promise<SessionRequest> {
  return new Promise((resolve, reject) => {
    const response = new ServerResponse(req);
    sessionMiddleware(req as SessionRequest & Parameters<RequestHandler>[0], response as Parameters<RequestHandler>[1], (err?: unknown) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(req as SessionRequest);
    });
  });
}

export function attachWebSockets(
  server: http.Server,
  options: {
    chatClients: Set<WebSocket>;
    logsClients: Set<WebSocket>;
    openAIApiKey: string;
    sessionMiddleware: RequestHandler;
  }
) {
  const { chatClients, logsClients, openAIApiKey, sessionMiddleware } = options;
  const copilotClients = new Set<WebSocket>();
  setCopilotBroadcast((msg) => {
    for (const ws of copilotClients) {
      if (isOpen(ws)) jsonSend(ws, msg);
    }
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const type = url.pathname.split('/').filter(Boolean)[0] || '';

    if (!type) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    if (isProtectedWebSocketPath(type)) {
      try {
        const sessionReq = await loadSession(req, sessionMiddleware);
        if (sessionReq.session?.authenticated !== true) {
          rejectUpgrade(socket, 401, 'Unauthorized');
          return;
        }
      } catch (error) {
        console.error('[ws][attach] Failed to load session for websocket upgrade:', error);
        rejectUpgrade(socket, 500, 'Internal Server Error');
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.length < 1) {
      ws.close();
      return;
    }

    const type = parts[0];

    if (type === 'call') {
      // Restore old logic: only one active Twilio connection (session.twilioConn)
      if (session && session.twilioConn) {
        try {
          console.warn('[ws][attach] Closing existing twilioConn due to new /call connection');
        } catch {}
        try {
          session.twilioConn.close();
        } catch {}
        session.twilioConn = undefined;
      }
      if (session && session.browserConn) {
        try {
          console.warn('[ws][attach] Closing existing browserConn due to new /call connection');
        } catch {}
        try {
          session.browserConn.close();
        } catch {}
        session.browserConn = undefined;
      }
      session.twilioConn = ws;
      establishCallSocket(ws, openAIApiKey);
      ws.on('close', (code: number, reason: Buffer) => {
        try {
          const r = reason?.toString?.() || '';
          console.warn('[ws][call] websocket closed', { code, reason: r });
        } catch {}
        if (session && session.twilioConn === ws) {
          session.twilioConn = undefined;
        }
      });
    } else if (type === 'browser-call') {
      if (session && session.twilioConn) {
        try {
          console.warn('[ws][attach] Closing existing twilioConn due to new /browser-call connection');
        } catch {}
        try {
          session.twilioConn.close();
        } catch {}
        session.twilioConn = undefined;
      }
      if (session && session.browserConn) {
        try {
          console.warn('[ws][attach] Closing existing browserConn due to new /browser-call connection');
        } catch {}
        try {
          session.browserConn.close();
        } catch {}
        session.browserConn = undefined;
      }
      session.browserConn = ws;
      establishBrowserCallSocket(ws, openAIApiKey);
      ws.on('close', (code: number, reason: Buffer) => {
        try {
          const r = reason?.toString?.() || '';
          console.warn('[ws][browser-call] websocket closed', { code, reason: r });
        } catch {}
        if (session && session.browserConn === ws) {
          session.browserConn = undefined;
        }
      });
    } else if (type === 'logs') {
      // Logs websocket is decommissioned; close connection
      try {
        ws.close();
      } catch {}
    } else if (type === 'chat') {
      chatClients.add(ws);
      establishChatSocket(ws, openAIApiKey, chatClients, logsClients);
      ws.on('close', () => chatClients.delete(ws));
    } else if (type === 'deepgram') {
      establishDeepgramProxy(ws);
    } else if (type === 'vnc-ws') {
      const token = url.searchParams.get('token') || '';
      if (!validateVncToken(token)) {
        ws.close(4401, 'Unauthorized');
        return;
      }
      handleVncWebSocket(ws);
    } else if (type === 'copilot') {
      copilotClients.add(ws);
      const activeSession = getActiveSession();
      if (activeSession) {
        jsonSend(ws, { type: 'copilot.session.active', ...activeSession });
      }
      ws.on('close', () => copilotClients.delete(ws));
    } else {
      ws.close();
    }
  });
}
