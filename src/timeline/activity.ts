import { randomUUID } from 'crypto';
import { addConversationEvent } from '../db/sqlite';
import { session, isOpen, jsonSend } from '../session/state';
import { chatClients } from '../ws/clients';

export type ActivitySpanKind = 'user' | 'voice' | 'inner';

function broadcast(event: Record<string, unknown>): void {
  for (const ws of chatClients) {
    if (isOpen(ws)) jsonSend(ws, event);
  }
}

export function ensureActivitySpan(
  conversationId: string,
  kind: ActivitySpanKind,
  channel: string,
): string {
  if (session.currentActivitySpanId) return session.currentActivitySpanId;
  const spanId = `span_${randomUUID()}`;
  const timestamp = Date.now();
  session.currentActivitySpanId = spanId;
  session.currentActivitySpanKind = kind;
  addConversationEvent({
    conversation_id: conversationId,
    kind: 'activity_span_started',
    payload: { span_id: spanId, kind, channel },
    created_at_ms: timestamp,
  });
  broadcast({
    type: 'timeline.span.started',
    span_id: spanId,
    conversation_id: conversationId,
    kind,
    channel,
    timestamp,
  });
  return spanId;
}

export function closeActivitySpan(
  conversationId: string,
  reason: string,
  details: Record<string, unknown> = {},
): void {
  const spanId = session.currentActivitySpanId;
  if (!spanId) return;
  broadcast({
    type: 'timeline.span.closed',
    span_id: spanId,
    conversation_id: conversationId,
    reason,
    ...details,
    timestamp: Date.now(),
  });
  session.currentActivitySpanId = undefined;
  session.currentActivitySpanKind = undefined;
}
