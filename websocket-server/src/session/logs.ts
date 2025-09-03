import { RawData, WebSocket } from "ws";
import { session, parseMessage, jsonSend, isOpen } from "./state";
import { endSession, ensureSession } from "../observability/thoughtflow";

// Build a base URL consistent with server.ts EFFECTIVE_PUBLIC_URL
const PORT = parseInt(process.env.PORT || "8081", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const EFFECTIVE_PUBLIC_URL = (PUBLIC_URL && PUBLIC_URL.trim()) || `http://localhost:${PORT}`;

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
  if (msg.type === "session.end") {
    try {
      // Ensure a session exists (creates one if missing)
      const { id } = ensureSession();
      const result = endSession();
      // Broadcast a tiny notification to all logs clients
      for (const ws of logsClients) {
        if (isOpen(ws)) jsonSend(ws, { type: 'session.finalized', session_id: id, ok: Boolean(result), timestamp: Date.now() });
      }
      // If we have artifact paths, broadcast them for UI breadcrumbs
      if (result && result.jsonPath && result.d2Path) {
        const url_json = `${EFFECTIVE_PUBLIC_URL}/thoughtflow/${id}.json`;
        const url_d2 = `${EFFECTIVE_PUBLIC_URL}/thoughtflow/${id}.d2`;
        const url_d2_raw = `${EFFECTIVE_PUBLIC_URL}/thoughtflow/raw/${id}.d2`;
        const url_d2_viewer = `${EFFECTIVE_PUBLIC_URL}/thoughtflow/viewer/${id}`;
        for (const ws of logsClients) {
          if (isOpen(ws)) jsonSend(ws, {
            type: 'thoughtflow.artifacts',
            session_id: id,
            json_path: result.jsonPath,
            d2_path: result.d2Path,
            url_json,
            url_d2,
            url_d2_raw,
            url_d2_viewer,
            timestamp: Date.now(),
          });
        }
      }
    } catch (e: any) {
      for (const ws of logsClients) {
        if (isOpen(ws)) jsonSend(ws, { type: 'session.finalized', error: e?.message || String(e), timestamp: Date.now() });
      }
    }
  }
}
