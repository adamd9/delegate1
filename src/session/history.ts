import { WebSocket } from 'ws';
import { jsonSend, isOpen } from './state';
import { listTimelineEvents } from '../db/sqlite';
import { configService } from '../config';

function toNumber(value: any, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getTimelineHistoryEventLimit(): number {
  const raw = configService.get('TIMELINE_HISTORY_EVENT_LIMIT');
  const n = toNumber(raw, 500);
  return Math.min(5000, Math.max(1, n));
}

// Map one DB event row into a UI event for the chat websocket
export function mapDbEventToUiEvent(row: any, convId: string, sessionId: string, baseTs: number, replay: boolean, spanId?: string): any[] {
  const out: any[] = [];
  const kind = row.kind as string;
  const payload = typeof row.payload_json === 'string' ? (() => { try { return JSON.parse(row.payload_json); } catch { return {}; } })() : (row.payload || {});
  const ts = row.created_at_ms || (typeof row.seq === 'number' ? (baseTs + row.seq) : Date.now());

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
  } else if (kind === 'canvas' || kind === 'note_created') {
    // Backward compat: old 'canvas' events mapped to chat.note alongside new 'note_created' events
    out.push({
      type: 'chat.note',
      ...(replay ? { replay: true } : {}),
      session_id: sessionId,
      conversation_id: convId,
      content: payload.url,
      title: payload.title,
      timestamp: ts,
      id: payload.id,
      url: payload.url,
    });
  } else if (kind === 'note_updated') {
    out.push({
      type: 'chat.note.updated',
      ...(replay ? { replay: true } : {}),
      session_id: sessionId,
      conversation_id: convId,
      id: payload.id,
      title: payload.title,
      url: payload.url,
      timestamp: ts,
    });
  } else if (kind === 'note_deleted') {
    out.push({
      type: 'chat.note.deleted',
      ...(replay ? { replay: true } : {}),
      session_id: sessionId,
      conversation_id: convId,
      id: payload.id,
      timestamp: ts,
    });
  } else if (kind === 'thoughtflow_artifacts') {
    out.push({
      type: 'thoughtflow.artifacts',
      ...(replay ? { replay: true } : {}),
      session_id: sessionId,
      conversation_id: convId,
      artifact_id: payload.artifact_id,
      json_path: payload.json_path,
      d2_path: payload.d2_path,
      url_json: payload.url_json,
      url_d2: payload.url_d2,
      url_d2_raw: payload.url_d2_raw,
      url_d2_viewer: payload.url_d2_viewer,
      timestamp: ts,
    });
  } else if (kind === 'inner_context') {
    out.push({
      type: 'inner.activation',
      phase: payload.mode === 'attached_to_user' ? 'attached' : 'started',
      ...(replay ? { replay: true } : {}),
      conversation_id: convId,
      signals: Array.isArray(payload.innerSignals) ? payload.innerSignals : [],
      composed_context: payload.text || '',
      timestamp: ts,
    });
  } else if (kind === 'inner_signal_published') {
    out.push({
      type: 'inner.signal',
      ...(replay ? { replay: true } : {}),
      conversation_id: convId,
      signal: payload.signal || {},
      timestamp: ts,
    });
  } else if (kind === 'inner_activation_completed' || kind === 'inner_activation_failed') {
    out.push({
      type: 'inner.activation',
      phase: kind === 'inner_activation_completed' ? 'completed' : 'failed',
      ...(replay ? { replay: true } : {}),
      conversation_id: convId,
      signals: Array.isArray(payload.signals) ? payload.signals : [],
      duration_ms: payload.duration_ms,
      ...(payload.error ? { error: payload.error } : {}),
      timestamp: ts,
    });
  } else if (kind === 'memory_retrieved') {
    out.push({ type: 'memory.retrieved', ...(replay ? { replay: true } : {}), conversation_id: convId, source: payload.source, count: payload.count, memories: payload.memories, preview: payload.preview, age_ms: payload.age_ms, elapsed_ms: payload.elapsed_ms, timestamp: ts });
  } else if (kind === 'memory_pending') {
    out.push({ type: 'memory.pending', ...(replay ? { replay: true } : {}), elapsed_ms: payload.elapsed_ms, timestamp: ts });
  } else if (kind === 'memory_miss') {
    out.push({ type: 'memory.miss', ...(replay ? { replay: true } : {}), timestamp: ts });
  } else if (kind === 'memory_stored') {
    out.push({ type: 'memory.stored', ...(replay ? { replay: true } : {}), facts: payload.facts, channel: payload.channel, timestamp: ts });
  } else if (kind === 'model_usage') {
    out.push({ type: 'context.usage', ...(replay ? { replay: true } : {}), conversation_id: convId, ...payload, timestamp: ts });
  } else if (kind === 'context_compacted') {
    out.push({ type: 'context.compacted', ...(replay ? { replay: true } : {}), conversation_id: convId, ...payload, timestamp: ts });
  } else if (kind === 'context_capsule') {
    out.push({
      type: 'context.capsule',
      phase: 'completed',
      ...(replay ? { replay: true } : {}),
      conversation_id: convId,
      channel: payload.channel,
      source: payload.source,
      throughTimestampMs: payload.throughTimestampMs,
      timestamp: ts,
    });
  } else if (kind === 'conversation_checkpoint') {
    out.push({
      type: 'timeline.checkpoint',
      ...(replay ? { replay: true } : {}),
      conversation_id: convId,
      span_id: payload.span_id || spanId,
      reason: payload.reason,
      from_seq: payload.from_seq,
      through_seq: payload.through_seq,
      turn_count: payload.turn_count,
      timestamp: ts,
    });
  }
  return out.map(event => spanId && !event.span_id ? { ...event, span_id: spanId } : event);
}

export function replayHistoryOnConnect(ws: WebSocket, requestedLimit?: number) {
  try {
    const configuredLimit = getTimelineHistoryEventLimit();
    const limit = requestedLimit === undefined
      ? configuredLimit
      : Math.min(5000, Math.max(configuredLimit, Math.floor(requestedLimit)));
    const page = listTimelineEvents(limit);
    const records = page.events as any[];
    if (isOpen(ws)) jsonSend(ws, { type: 'history.header', count: 0 });
    const activeSpans = new Map<string, string>();
    const conversationMeta = new Map<string, any>();
    const seenThoughtflow = new Set<string>();

    for (const event of records) {
      const convId = event.conversation_id as string;
      const conv = {
        id: convId,
        session_id: event.session_id,
        channel: event.conversation_channel,
        ended_at: event.conversation_ended_at,
        status: event.conversation_status,
      };
      conversationMeta.set(convId, conv);
      const base = event.created_at_ms || Date.now();
      if (event.kind === 'thoughtflow_artifacts') {
        if (seenThoughtflow.has(convId)) continue;
        seenThoughtflow.add(convId);
      }
      const payload = typeof event.payload_json === 'string' ? (() => { try { return JSON.parse(event.payload_json); } catch { return {}; } })() : (event.payload || {});
      if (event.kind === 'activity_span_started') {
        const spanId = payload.span_id || `span_${convId}_${event.seq}`;
        activeSpans.set(convId, spanId);
        if (isOpen(ws)) jsonSend(ws, {
          type: 'timeline.span.started', replay: true, span_id: spanId,
          conversation_id: convId, kind: payload.kind || 'user',
          channel: payload.channel || conv.channel || 'text',
          timestamp: event.created_at_ms || base + event.seq,
        });
        continue;
      }
      if (event.kind === 'activity_span_closed') {
        const spanId = payload.span_id || activeSpans.get(convId);
        if (spanId && isOpen(ws)) jsonSend(ws, {
          type: 'timeline.span.closed', replay: true, span_id: spanId,
          conversation_id: convId, reason: payload.reason || 'completed',
          ...payload, timestamp: event.created_at_ms || base + event.seq,
        });
        if (spanId === activeSpans.get(convId)) activeSpans.delete(convId);
        continue;
      }
      let activeSpanId = activeSpans.get(convId);
      if (event.kind === 'inner_signal_published' && !activeSpanId) {
        for (const uiEvent of mapDbEventToUiEvent(event, convId, conv.session_id, base, true)) {
          if (isOpen(ws)) jsonSend(ws, uiEvent);
        }
        continue;
      }
      if (!activeSpanId) {
        activeSpanId = `span_legacy_${convId}_${event.seq}`;
        activeSpans.set(convId, activeSpanId);
        if (isOpen(ws)) jsonSend(ws, {
          type: 'timeline.span.started', replay: true, span_id: activeSpanId,
          conversation_id: convId,
          kind: event.kind === 'inner_context' ? 'inner' : (conv.channel === 'voice' ? 'voice' : 'user'),
          channel: conv.channel || 'text', timestamp: event.created_at_ms || base + event.seq,
        });
      }
      for (const uiEvent of mapDbEventToUiEvent(event, convId, conv.session_id, base, true, activeSpanId)) {
        if (isOpen(ws)) jsonSend(ws, uiEvent);
      }
      if (event.kind === 'conversation_checkpoint') {
        if (isOpen(ws)) jsonSend(ws, {
          type: 'timeline.span.closed', replay: true, span_id: activeSpanId,
          conversation_id: convId, reason: payload.reason || 'checkpoint',
          turn_count: payload.turn_count, timestamp: event.created_at_ms || base + event.seq,
        });
        activeSpans.delete(convId);
      }
    }

    for (const conv of conversationMeta.values()) {
      const activeSpanId = activeSpans.get(conv.id);
      if (activeSpanId && conv.ended_at && isOpen(ws)) jsonSend(ws, {
        type: 'timeline.span.closed',
        replay: true,
        span_id: activeSpanId,
        conversation_id: conv.id,
        reason: conv.status || 'completed',
        timestamp: new Date(conv.ended_at).getTime(),
      });
    }
    if (isOpen(ws)) jsonSend(ws, {
      type: 'history.page',
      event_count: records.length,
      limit: page.limit,
      has_more: page.hasMore,
      timestamp: Date.now(),
    });
  } catch (e) {
    console.warn('[history] auto history replay failed:', (e as any)?.message || e);
  }
}
