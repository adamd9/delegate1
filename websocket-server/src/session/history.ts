import { WebSocket } from 'ws';
import { jsonSend, isOpen } from './state';
import { listConversations as dbListConversations, listConversationEvents } from '../db/sqlite';

function toNumber(value: any, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getSessionHistoryLimit(): number {
  const raw = process.env.SESSION_HISTORY_LIMIT;
  const n = toNumber(raw, 3);
  return Math.min(50, Math.max(1, n));
}

// Map one DB event row into a UI event for the chat websocket
function mapDbEventToUiEvent(row: any, convId: string, sessionId: string, baseTs: number, replay: boolean): any[] {
  const out: any[] = [];
  const kind = row.kind as string;
  const payload = typeof row.payload_json === 'string' ? (() => { try { return JSON.parse(row.payload_json); } catch { return {}; } })() : (row.payload || {});
  const ts = (typeof row.seq === 'number' ? (baseTs + row.seq) : (row.created_at_ms || Date.now()));

  if (kind === 'message_user' || kind === 'message_assistant') {
    out.push({
      type: 'conversation.item.created',
      ...(replay ? { replay: true } : {}),
      session_id: sessionId,
      conversation_id: convId,
      item: {
        id: `ti_${row.seq}`,
        type: 'message',
        role: kind === 'message_user' ? 'user' : 'assistant',
        content: [{ type: 'text', text: String(payload.text || '') }],
        channel: payload.channel || 'text',
        supervisor: Boolean(payload.supervisor),
      },
      timestamp: ts,
    });
  } else if (kind === 'function_call_created') {
    out.push({
      type: 'conversation.item.created',
      ...(replay ? { replay: true } : {}),
      session_id: sessionId,
      conversation_id: convId,
      item: {
        id: String(payload.call_id || `call_${row.seq}`),
        type: 'function_call',
        name: payload.name || 'tool',
        call_id: payload.call_id || `call_${row.seq}`,
        arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
        status: 'created',
      },
      timestamp: ts,
    });
  } else if (kind === 'function_call_completed') {
    out.push({
      type: 'conversation.item.completed',
      ...(replay ? { replay: true } : {}),
      session_id: sessionId,
      conversation_id: convId,
      item: {
        id: String(payload.call_id || `call_${row.seq}`),
        type: 'function_call',
        name: payload.name || 'tool',
        call_id: payload.call_id || `call_${row.seq}`,
        arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
        status: 'completed',
        result: typeof payload.result === 'string' ? payload.result : (payload.result ? JSON.stringify(payload.result) : undefined),
      },
      timestamp: ts,
    });
  } else if (kind === 'canvas') {
    out.push({
      type: 'chat.canvas',
      ...(replay ? { replay: true } : {}),
      session_id: sessionId,
      conversation_id: convId,
      content: payload.url,
      title: payload.title,
      timestamp: ts,
      id: payload.id,
    });
  } else if (kind === 'thoughtflow_artifacts') {
    out.push({
      type: 'thoughtflow.artifacts',
      ...(replay ? { replay: true } : {}),
      session_id: sessionId,
      conversation_id: convId,
      json_path: payload.json_path,
      d2_path: payload.d2_path,
      url_json: payload.url_json,
      url_d2: payload.url_d2,
      url_d2_raw: payload.url_d2_raw,
      url_d2_viewer: payload.url_d2_viewer,
      timestamp: ts,
    });
  }
  return out;
}

export function replayHistoryOnConnect(ws: WebSocket) {
  try {
    const limit = getSessionHistoryLimit();
    const conversations: any[] = dbListConversations(limit) || [];
    const ended = conversations.filter((c: any) => Boolean(c.ended_at));
    const open = conversations.find((c: any) => !c.ended_at);

    // Header for history section (ended runs only)
    if (isOpen(ws)) jsonSend(ws, { type: 'history.header', count: ended.length });

    // Replay ended runs under history (replay: true)
    for (const conv of ended) {
      const convId = conv.id;
      const events = listConversationEvents(convId) as any[];
      const base = (Array.isArray(events) && events.length > 0 && events[0].created_at_ms) || Date.now();
      const seenKinds = new Set<string>();
      for (const e of events) {
        if (e.kind === 'thoughtflow_artifacts') {
          if (seenKinds.has('thoughtflow_artifacts')) continue;
          seenKinds.add('thoughtflow_artifacts');
        }
        const uiEvents = mapDbEventToUiEvent(e, convId, conv.session_id, base, true);
        for (const evt of uiEvents) {
          if (isOpen(ws)) jsonSend(ws, evt);
        }
      }
    }

    // Replay current open run (if any) into the live area (replay: false)
    if (open) {
      const convId = open.id;
      const events = listConversationEvents(convId) as any[];
      const base = (Array.isArray(events) && events.length > 0 && events[0].created_at_ms) || Date.now();
      const seenKinds = new Set<string>();
      for (const e of events) {
        if (e.kind === 'thoughtflow_artifacts') {
          if (seenKinds.has('thoughtflow_artifacts')) continue;
          seenKinds.add('thoughtflow_artifacts');
        }
        const uiEvents = mapDbEventToUiEvent(e, convId, open.session_id, base, false);
        for (const evt of uiEvents) {
          if (isOpen(ws)) jsonSend(ws, evt);
        }
      }
    }
  } catch (e) {
    console.warn('[history] auto history replay failed:', (e as any)?.message || e);
  }
}
