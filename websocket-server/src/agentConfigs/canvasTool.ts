import { FunctionHandler } from './types';
import { WebSocket } from 'ws';

function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

export const sendCanvas: FunctionHandler = {
  schema: {
    name: "send_canvas",
    type: "function",
    description: "Send detailed content to the canvas UI.",
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
  handler: async ({ content, title }: { content: string; title?: string }) => {
    const message = { type: "chat.canvas", content, title, timestamp: Date.now() };

    const globals = globalThis as any;
    const chatClients: Set<WebSocket> = globals.chatClients ?? new Set();
    const logsClients: Set<WebSocket> = globals.logsClients ?? new Set();

    for (const client of chatClients) {
      jsonSend(client, message);
    }
    for (const client of logsClients) {
      jsonSend(client, message);
    }

    return "canvas_sent";
  }
};
