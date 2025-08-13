import { FunctionHandler } from './types';
import { WebSocket } from 'ws';
import { storeCanvas } from '../canvasStore';
import { session, type ConversationItem } from '../session/state';

const PUBLIC_URL = process.env.PUBLIC_URL || '';
const DEFAULT_PORT = process.env.PORT || '8081';
const EFFECTIVE_PUBLIC_URL = (PUBLIC_URL && PUBLIC_URL.trim()) || `http://localhost:${DEFAULT_PORT}`;

function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

export const sendCanvas: FunctionHandler = {
  schema: {
    name: "send_canvas",
    type: "function",
    description: "Send detailed content to the user using a special UI. This will be sent out as a link to the user via a separate channel. No need to supply the link in the message back to the user.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        title: { type: "string" }
      },
      required: ["content", "title"],
      additionalProperties: false
    }
  },
  handler: async (
    { content, title }: { content: string; title?: string },
  ) => {
    console.debug("[DEBUG] CanvasTool handler called:", { content, title });
    const id = await storeCanvas(content, title);
    const base = EFFECTIVE_PUBLIC_URL.replace(/\/$/, '');
    const url = `${base}/canvas/${id}`;
    const message = { type: "chat.canvas", content: url, title, timestamp: Date.now(), id };

    const entry: ConversationItem = {
      type: 'canvas',
      content: url,
      title,
      timestamp: message.timestamp,
      id,
    };
    if (!session.conversationHistory) {
      session.conversationHistory = [];
    }
    session.conversationHistory.push(entry);

    const globals = globalThis as any;
    const chatClients: Set<WebSocket> = globals.chatClients ?? new Set();
    const logsClients: Set<WebSocket> = globals.logsClients ?? new Set();

    for (const client of chatClients) {
      jsonSend(client, message);
    }
    for (const client of logsClients) {
      jsonSend(client, message);
    }

    return { status: "sent", id, url, title: title ?? null };
  }
};
