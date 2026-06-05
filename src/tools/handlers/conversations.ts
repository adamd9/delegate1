import { FunctionHandler } from '../../agentConfigs/types';
import { getDb, listConversationEvents } from '../../db/sqlite';
import { createOpenAIClient } from '../../services/openaiClient';

type ConversationRow = {
  id: string;
  session_id: string;
  channel?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  status?: string | null;
  duration_ms?: number | null;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const NL_MODEL = 'gpt-5-mini';

function parseFirstJsonObject(text: string): any | null {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
  }
  return null;
}

type ConversationIntent = {
  conversation_id: string | null;
  semantic_query: string | null;
  limit: number;
  only_ended: boolean;
  include_messages: boolean;
  max_turns_per_conversation: number;
};

async function inferIntentWithModel(args: {
  request?: string;
  conversation_id?: string;
  query?: string;
  limit?: number;
  include_messages?: boolean;
  max_turns_per_conversation?: number;
  only_ended?: boolean;
}): Promise<ConversationIntent> {
  const explicitDefaults: ConversationIntent = {
    conversation_id: args.conversation_id || null,
    semantic_query: args.query || args.request || null,
    limit: clamp(Number(args.limit ?? 5) || 5, 1, 20),
    only_ended: args.only_ended == null ? true : Boolean(args.only_ended),
    include_messages: args.include_messages == null ? true : Boolean(args.include_messages),
    max_turns_per_conversation: clamp(Number(args.max_turns_per_conversation ?? 20) || 20, 1, 100),
  };

  if (!args.request || !args.request.trim()) {
    return explicitDefaults;
  }

  try {
    const client = createOpenAIClient();
    const completion = await client.chat.completions.create({
      model: NL_MODEL,
      temperature: 0,
      max_tokens: 250,
      messages: [
        {
          role: 'system',
          content:
            'You convert natural language conversation-history requests into tool arguments. Return JSON only with keys: conversation_id, semantic_query, limit, only_ended, include_messages, max_turns_per_conversation. ' +
            'Rules: "last conversation" => limit 1. "last few conversations" => limit 3. If user asks for a specific topic, set semantic_query. Default only_ended=true unless user asks for open/in-progress conversations.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            request: args.request,
            explicit_args: {
              conversation_id: args.conversation_id ?? null,
              query: args.query ?? null,
              limit: args.limit ?? null,
              include_messages: args.include_messages ?? null,
              max_turns_per_conversation: args.max_turns_per_conversation ?? null,
              only_ended: args.only_ended ?? null,
            },
          }),
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    const parsed = parseFirstJsonObject(raw) || {};

    return {
      conversation_id: typeof parsed.conversation_id === 'string' && parsed.conversation_id.trim() ? parsed.conversation_id.trim() : explicitDefaults.conversation_id,
      semantic_query: typeof parsed.semantic_query === 'string' && parsed.semantic_query.trim() ? parsed.semantic_query.trim() : explicitDefaults.semantic_query,
      limit: clamp(Number(parsed.limit ?? explicitDefaults.limit) || explicitDefaults.limit, 1, 20),
      only_ended: parsed.only_ended == null ? explicitDefaults.only_ended : Boolean(parsed.only_ended),
      include_messages: parsed.include_messages == null ? explicitDefaults.include_messages : Boolean(parsed.include_messages),
      max_turns_per_conversation: clamp(
        Number(parsed.max_turns_per_conversation ?? explicitDefaults.max_turns_per_conversation) || explicitDefaults.max_turns_per_conversation,
        1,
        100
      ),
    };
  } catch {
    return explicitDefaults;
  }
}

function compactText(text: string, maxLen = 400): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

function extractMessages(conversationId: string, maxTurns: number) {
  const events = (listConversationEvents(conversationId) || []) as any[];
  const turns: Array<{ role: 'user' | 'assistant'; text: string; seq: number }> = [];
  for (const evt of events) {
    if (evt.kind !== 'message_user' && evt.kind !== 'message_assistant') continue;
    const payload = (() => {
      try { return JSON.parse(evt.payload_json || '{}'); } catch { return {}; }
    })();
    if (payload?.internal) continue;
    turns.push({
      role: evt.kind === 'message_user' ? 'user' : 'assistant',
      text: compactText(String(payload?.text || ''), 500),
      seq: Number(evt.seq) || 0,
    });
  }
  return turns.slice(-maxTurns);
}

async function rankConversationCandidatesWithModel(args: {
  request?: string;
  query?: string;
  limit: number;
  candidates: Array<{
    id: string;
    channel?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
    status?: string | null;
    preview: string;
  }>;
}): Promise<string[] | null> {
  const requestText = String(args.request || args.query || '').trim();
  if (!requestText) return null;
  if (args.candidates.length === 0) return [];
  try {
    const client = createOpenAIClient();
    const completion = await client.chat.completions.create({
      model: NL_MODEL,
      temperature: 0,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content:
            'You rank conversation candidates for relevance to a request. Return JSON only: {"selected_ids":["id1",...]} with at most the requested limit and IDs only from candidates.',
        },
        {
          role: 'user',
          content: JSON.stringify({ request: requestText, limit: args.limit, candidates: args.candidates }),
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content || '';
    const parsed = parseFirstJsonObject(raw) || {};
    const selected = Array.isArray(parsed.selected_ids)
      ? parsed.selected_ids.filter((v: any) => typeof v === 'string')
      : [];
    const validSet = new Set(args.candidates.map((c) => c.id));
    return selected.filter((id: string) => validSet.has(id)).slice(0, args.limit);
  } catch {
    return null;
  }
}

function queryConversations(args: {
  limit: number;
  onlyEnded: boolean;
  searchText?: string;
  conversationId?: string;
}): ConversationRow[] {
  const db = getDb();
  const search = String(args.searchText || '').trim().toLowerCase();

  if (args.conversationId) {
    const row = db.prepare(
      `SELECT id, session_id, channel, started_at, ended_at, status, duration_ms
       FROM conversations
       WHERE id = ?`
    ).get(args.conversationId) as ConversationRow | undefined;
    return row ? [row] : [];
  }

  if (search) {
    const like = `%${search}%`;
    return db.prepare(
      `SELECT c.id, c.session_id, c.channel, c.started_at, c.ended_at, c.status, c.duration_ms
       FROM conversations c
       WHERE (? = 0 OR c.ended_at IS NOT NULL)
         AND (
           lower(c.id) LIKE ?
           OR lower(coalesce(c.channel, '')) LIKE ?
           OR EXISTS (
             SELECT 1
             FROM conversation_events e
             WHERE e.conversation_id = c.id
               AND lower(coalesce(e.payload_json, '')) LIKE ?
           )
         )
       ORDER BY COALESCE(c.ended_at, c.started_at) DESC
       LIMIT ?`
    ).all(args.onlyEnded ? 1 : 0, like, like, like, args.limit) as ConversationRow[];
  }

  return db.prepare(
    `SELECT id, session_id, channel, started_at, ended_at, status, duration_ms
     FROM conversations
     WHERE (? = 0 OR ended_at IS NOT NULL)
     ORDER BY COALESCE(ended_at, started_at) DESC
     LIMIT ?`
  ).all(args.onlyEnded ? 1 : 0, args.limit) as ConversationRow[];
}

export const readConversationsFunction: FunctionHandler = {
  schema: {
    name: 'read_conversations',
    type: 'function',
    description: 'Read or search persisted conversation history from this assistant\'s local SQLite database. Supports natural requests like "last conversation" or "last few conversations".',
    parameters: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'Natural language request, for example: "last conversation", "last few conversations", or "find conversation about deployment".',
        },
        conversation_id: {
          type: 'string',
          description: 'Optional explicit conversation id to rehydrate.',
        },
        query: {
          type: 'string',
          description: 'Optional text filter matched against conversation ids/channels and event payload JSON.',
        },
        limit: {
          type: 'number',
          description: 'Maximum conversations to return (default inferred from request, max 20).',
        },
        include_messages: {
          type: 'boolean',
          description: 'When true, include recent user/assistant turns from each conversation.',
        },
        max_turns_per_conversation: {
          type: 'number',
          description: 'Maximum number of recent turns to include per conversation when include_messages=true (default 20, max 100).',
        },
        only_ended: {
          type: 'boolean',
          description: 'When true (default), return only finalized conversations.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  handler: async (args: {
    request?: string;
    conversation_id?: string;
    query?: string;
    limit?: number;
    include_messages?: boolean;
    max_turns_per_conversation?: number;
    only_ended?: boolean;
  }) => {
    try {
      const intent = await inferIntentWithModel(args);
      const limit = intent.limit;
      const includeMessages = intent.include_messages;
      const onlyEnded = intent.only_ended;
      const maxTurns = intent.max_turns_per_conversation;
      const semanticQuery = intent.semantic_query || args.query || args.request;
      const conversationId = intent.conversation_id || args.conversation_id;

      const rows = queryConversations({
        limit: conversationId ? 1 : clamp(limit * 8, 20, 80),
        onlyEnded,
        searchText: conversationId ? undefined : (semanticQuery || undefined),
        conversationId: conversationId || undefined,
      });

      let selectedRows = rows;
      if (!conversationId && semanticQuery && rows.length > limit) {
        const candidatesForModel = rows.slice(0, clamp(limit * 8, 20, 80)).map((row) => {
          const previewTurns = extractMessages(row.id, 6);
          const preview = previewTurns.map((t) => `${t.role}: ${t.text}`).join('\n');
          return {
            id: row.id,
            channel: row.channel,
            started_at: row.started_at,
            ended_at: row.ended_at,
            status: row.status,
            preview,
          };
        });

        const selectedIds = await rankConversationCandidatesWithModel({
          request: args.request,
          query: semanticQuery,
          limit,
          candidates: candidatesForModel,
        });

        if (selectedIds && selectedIds.length > 0) {
          const order = new Map(selectedIds.map((id, idx) => [id, idx]));
          selectedRows = rows
            .filter((r) => order.has(r.id))
            .sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
        } else {
          selectedRows = rows.slice(0, limit);
        }
      } else {
        selectedRows = rows.slice(0, limit);
      }

      const conversations = selectedRows.map((row) => {
        const messages = includeMessages ? extractMessages(row.id, maxTurns) : undefined;
        const counts = messages
          ? {
              user: messages.filter((m) => m.role === 'user').length,
              assistant: messages.filter((m) => m.role === 'assistant').length,
              total: messages.length,
            }
          : undefined;

        return {
          id: row.id,
          session_id: row.session_id,
          channel: row.channel || 'unknown',
          started_at: row.started_at,
          ended_at: row.ended_at,
          status: row.status,
          duration_ms: row.duration_ms,
          message_counts: counts,
          messages,
        };
      });

      return {
        source: 'assistant_conversation_db',
        ownership_context: 'These are this assistant\'s own persisted conversations from local SQLite (table: conversations + conversation_events).',
        applied: {
          request: args.request || null,
          conversation_id: conversationId || null,
          query: args.query || null,
          semantic_query: semanticQuery || null,
          limit,
          only_ended: onlyEnded,
          include_messages: includeMessages,
          max_turns_per_conversation: maxTurns,
        },
        count: conversations.length,
        conversations,
      };
    } catch (e: any) {
      return { error: e?.message || 'Failed to read conversations' };
    }
  },
};
