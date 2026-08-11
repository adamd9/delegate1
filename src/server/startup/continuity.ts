import { getDb } from '../../db/sqlite';
import { session } from '../../session/state';

function parsePayload(value: string): Record<string, any> {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

export function resumeOpenTimelineOnStartup(): void {
  try {
    const database = getDb();
    const conversation = database.prepare(`
      SELECT c.id, c.session_id, c.started_at, s.started_at AS session_started_at
      FROM conversations c
      LEFT JOIN sessions s ON s.id = c.session_id
      WHERE c.ended_at IS NULL
      ORDER BY COALESCE(
        (SELECT MAX(e.created_at_ms) FROM conversation_events e WHERE e.conversation_id = c.id),
        CAST(strftime('%s', c.started_at) AS INTEGER) * 1000
      ) DESC
      LIMIT 1
    `).get() as { id: string; session_id: string; started_at?: string; session_started_at?: string } | undefined;
    if (!conversation) return;

    const rows = database.prepare(`
      SELECT kind, payload_json, created_at_ms
      FROM conversation_events
      WHERE conversation_id = ?
      ORDER BY seq DESC
      LIMIT 80
    `).all(conversation.id) as Array<{ kind: string; payload_json: string; created_at_ms: number }>;
    const chronological = rows.slice().reverse();
    session.currentConversationId = conversation.id;
    session.thoughtflow = {
      sessionId: conversation.session_id,
      startedAt: Date.parse(conversation.session_started_at || conversation.started_at || '') || Date.now(),
    };
    session.conversationHistory = chronological
      .filter(row => row.kind === 'message_user' || row.kind === 'message_assistant')
      .map(row => {
        const payload = parsePayload(row.payload_json);
        return {
          type: row.kind === 'message_user' ? 'user' as const : 'assistant' as const,
          content: String(payload.text || ''),
          timestamp: row.created_at_ms,
          channel: payload.channel || 'text',
          supervisor: Boolean(payload.supervisor),
        };
      });

    for (const row of rows) {
      if (row.kind === 'conversation_checkpoint') break;
      if (row.kind === 'activity_span_started') {
        const payload = parsePayload(row.payload_json);
        session.currentActivitySpanId = payload.span_id;
        session.currentActivitySpanKind = payload.kind;
        break;
      }
    }
    database.prepare("UPDATE sessions SET status = 'open', ended_at = NULL WHERE id = ?").run(conversation.session_id);
    console.log(`[startup] Resumed open timeline conversation=${conversation.id} session=${conversation.session_id} turns=${session.conversationHistory.length}`);
  } catch (error: any) {
    console.warn('[startup] Failed to resume open timeline:', error?.message || error);
  }
}