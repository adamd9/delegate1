import type { Application, Request, Response } from 'express';
import { WebSocket } from 'ws';
import { session as stateSession, closeAllConnections, jsonSend, isOpen } from '../../session/state';
import { memoryModule } from '../../memory';
import { compactCurrentContext, getContextStatus } from '../../session/contextControl';

export function registerSessionRoutes(app: Application, opts: { chatClients: Set<WebSocket>; logsClients: Set<WebSocket>; }) {
  const { chatClients, logsClients } = opts;
  const broadcastContextActivity = (event: Record<string, unknown>) => {
    for (const ws of chatClients) {
      if (isOpen(ws)) jsonSend(ws, event);
    }
  };

  app.get('/api/session/context', (_req: Request, res: Response) => {
    res.json(getContextStatus());
  });

  app.post('/api/session/context/compact', async (_req: Request, res: Response) => {
    try {
      const status = await compactCurrentContext(broadcastContextActivity);
      res.json({ status: 'ok', context: status });
    } catch (error: any) {
      const message = error?.message || 'Context compaction failed.';
      const conflict = /already in progress|active response|no active Responses context/i.test(message);
      res.status(conflict ? 409 : 500).json({ status: 'error', message, context: getContextStatus() });
    }
  });

  // Endpoint to reset session state: chat history and/or active connections
  // Body JSON shape: { chatHistory?: boolean, connections?: boolean }
  app.post('/session/reset', (req: Request, res: Response) => {
    const { chatHistory = true, connections = true } = (req.body as any) || {};
    try {
      const result: any = { chatHistoryCleared: false, connectionsClosed: false };

      if (connections) {
        // Close model/twilio/frontend tracked in state
        closeAllConnections();
        // Close any chat/text model connections tracked in state
        try {
          if (stateSession.chatConn && stateSession.chatConn.readyState === WebSocket.OPEN) {
            stateSession.chatConn.close();
          }
        } catch {}
        (stateSession as any).chatConn = undefined;
        try {
          if (stateSession.textModelConn && stateSession.textModelConn.readyState === WebSocket.OPEN) {
            stateSession.textModelConn.close();
          }
        } catch {}
        (stateSession as any).textModelConn = undefined;
        // Close and clear all observability and chat clients
        try {
          for (const ws of chatClients) {
            try { ws.close(); } catch {}
          }
          chatClients.clear();
        } catch {}
        try {
          for (const ws of logsClients) {
            try { ws.close(); } catch {}
          }
          logsClients.clear();
        } catch {}
        result.connectionsClosed = true;
      }

      if (chatHistory) {
        (stateSession as any).conversationHistory = [];
        (stateSession as any).previousResponseId = undefined;
        (stateSession as any).pendingCompactedInput = undefined;
        memoryModule.clearCache();
        result.chatHistoryCleared = true;
      }

      // Emit an observability log event over the logs websocket
      try {
        for (const ws of logsClients) {
          if (isOpen(ws))
            jsonSend(ws, {
              type: 'session.reset',
              by: 'api',
              chatHistory,
              connections,
              result,
              timestamp: Date.now(),
            });
        }
      } catch {}

      res.json({ status: 'ok', ...result });
    } catch (err: any) {
      console.error('/session/reset error:', err);
      res.status(500).json({ status: 'error', message: err?.message || 'Unknown error' });
    }
  });
}
