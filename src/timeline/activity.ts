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
  const canReuse = session.currentActivitySpanId
    && session.currentActivitySpanConversationId === conversationId
    && session.currentActivitySpanKind === kind
    && session.currentActivitySpanChannel === channel;
  if (canReuse) return session.currentActivitySpanId!;
  if (session.currentActivitySpanId) {
    closeActivitySpan(
      session.currentActivitySpanConversationId || conversationId,
      'activity_changed',
      { next_kind: kind, next_channel: channel },
    );
  }
  const spanId = `span_${randomUUID()}`;
  const timestamp = Date.now();
  session.currentActivitySpanId = spanId;
  session.currentActivitySpanKind = kind;
  session.currentActivitySpanChannel = channel;
  session.currentActivitySpanConversationId = conversationId;
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
  const timestamp = Date.now();
  const activeConversationId = session.currentActivitySpanConversationId || conversationId;
  addConversationEvent({
    conversation_id: activeConversationId,
    kind: 'activity_span_closed',
    payload: { span_id: spanId, reason, ...details },
    created_at_ms: timestamp,
  });
  broadcast({
    type: 'timeline.span.closed',
    span_id: spanId,
    conversation_id: activeConversationId,
    reason,
    ...details,
    timestamp,
  });
  session.currentActivitySpanId = undefined;
  session.currentActivitySpanKind = undefined;
  session.currentActivitySpanChannel = undefined;
  session.currentActivitySpanConversationId = undefined;
}
