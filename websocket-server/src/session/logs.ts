import { RawData, WebSocket } from "ws";
import { session, parseMessage, jsonSend, isOpen } from "./state";

export function establishLogsSocket(ws: WebSocket, logsClients: Set<WebSocket>) {
  // On new logs/observability connection, replay existing conversation history
  // so the UI can immediately render the current transcript without waiting
  // for new events. This stream is consumed by the web frontend at `/logs`.
  if (session.conversationHistory) {
    for (const msg of session.conversationHistory) {
      if (msg.type === 'canvas') {
        jsonSend(ws, {
          type: 'chat.canvas',
          content: msg.content,
          title: msg.title,
          timestamp: msg.timestamp,
          id: msg.id,
        });
      } else {
        jsonSend(ws, {
          type: "conversation.item.created",
          item: {
            id: `msg_${msg.timestamp}`,
            type: "message",
            role: msg.type,
            content: [{ type: "text", text: msg.content }],
            channel: msg.channel,
            supervisor: msg.supervisor,
          },
        });
      }
    }
  }

  // While `/logs` is primarily for outbound events, the UI may also send
  // control messages (e.g. session.update). We pass them along here.
  ws.on("message", (data) => processLogsSocketMessage(data, logsClients));
  // No session cleanup here; handled by Set in server.ts
}

export function processLogsSocketMessage(data: RawData, logsClients: Set<WebSocket>) {
  const msg = parseMessage(data);
  if (!msg) return;

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, msg);
  }

  if (msg.type === "session.update") {
    session.saved_config = msg.session;
  }
}
