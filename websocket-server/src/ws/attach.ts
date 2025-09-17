import { WebSocketServer, WebSocket } from 'ws';
import type http from 'http';
import { IncomingMessage } from 'http';
import { establishCallSocket } from '../session/call';
import { establishChatSocket } from '../session/chat';
import session from '../sessionSingleton';

/**
 * Attaches a WebSocketServer to the given HTTP server and wires up
 * handlers for `wss://.../call` and `wss://.../chat` paths.
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
          session.twilioConn.close();
        } catch {}
        session.twilioConn = undefined;
      }
      session.twilioConn = ws;
      establishCallSocket(ws, openAIApiKey);
      ws.on('close', () => {
        if (session && session.twilioConn === ws) {
          session.twilioConn = undefined;
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
