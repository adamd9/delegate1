import { RawData, WebSocket } from "ws";
import { session, parseMessage, jsonSend, isOpen } from "./state";
import { endSession, ensureSession, ThoughtFlowStepType } from "../observability/thoughtflow";

// Build a base URL consistent with server.ts EFFECTIVE_PUBLIC_URL
const PORT = parseInt(process.env.PORT || "8081", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const EFFECTIVE_PUBLIC_URL = (PUBLIC_URL && PUBLIC_URL.trim()) || `http://localhost:${PORT}`;

export function establishLogsSocket(ws: WebSocket, logsClients: Set<WebSocket>) {
  // While `/logs` is primarily for outbound events, the UI may also send
  // control messages (e.g. session.update). We pass them along here.
  ws.on("message", (data) => processLogsSocketMessage(data, logsClients, ws));
  // No session cleanup here; handled by Set in server.ts
}

export function processLogsSocketMessage(data: RawData, logsClients: Set<WebSocket>, requester?: WebSocket) {
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
      // Clear conversation threading for model context to exclude ended sessions
      try { (session as any).previousResponseId = undefined; } catch {}
      // Broadcast a tiny notification to all logs clients
      for (const ws of logsClients) {
        if (isOpen(ws)) jsonSend(ws, { type: 'session.finalized', session_id: id, ok: Boolean(result), timestamp: Date.now() });
      }
      // Per-run ThoughtFlow artifacts are generated during run completion in observability/thoughtflow.ts
    } catch (e: any) {
      for (const ws of logsClients) {
        if (isOpen(ws)) jsonSend(ws, { type: 'session.finalized', error: e?.message || String(e), timestamp: Date.now() });
      }
    }
  }
}

function safeJson(s: string): any | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}
