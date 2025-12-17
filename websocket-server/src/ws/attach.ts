import { WebSocketServer, WebSocket } from 'ws';
import type http from 'http';
import { IncomingMessage } from 'http';
import { establishCallSocket } from '../session/call';
import { establishBrowserCallSocket } from '../session/browserCall';
import { establishChatSocket } from '../session/chat';
import { session } from '../session/state';

/**
 * Attaches a WebSocketServer to the given HTTP server and wires up
 * handlers for `wss://.../call`, `wss://.../browser-call`, and `wss://.../chat` paths.
 *
 * logs websocket is decommissioned; it is treated as closed.
 */
export function attachWebSockets(
  server: http.Server,
  options: {
    chatClients: Set<WebSocket>;
    logsClients: Set<WebSocket>;
    openAIApiKey: string;
  }
) {
  const { chatClients, logsClients, openAIApiKey } = options;
  const wss = new WebSocketServer({ server });

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
    } else {
      ws.close();
    }
  });
}
