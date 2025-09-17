import type { Application, Request, Response } from 'express';
import { listConversations as dbListConversations, getConversationById, listConversationEvents } from '../../db/sqlite';

export function registerConversationRoutes(app: Application, opts?: { defaultLimit?: number }) {
  const SESSION_HISTORY_LIMIT = Number(process.env.SESSION_HISTORY_LIMIT || 3);
  const defaultLimit = opts?.defaultLimit ?? SESSION_HISTORY_LIMIT;

  // Conversations list endpoint (conversation-centric)
  app.get('/api/conversations', (req: Request, res: Response) => {
    try {
      const limit = Math.max(1, Math.min(50, Number((req.query as any).limit) || defaultLimit));
      const list = dbListConversations(limit);
      // Returns: [{ id: conversation_id, session_id, channel, started_at, ended_at, status, duration_ms }, ...]
      res.json(list);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to list conversations' });
    }
  });

  // Conversation detail endpoint (single conversation + steps)
  app.get('/api/conversations/:id', (req: Request, res: Response) => {
    try {
      const id = (req.params as any).id as string;
      const detail = getConversationById(id);
      if (!detail) return res.status(404).json({ error: 'Not found' });
      res.json(detail);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to get conversation' });
    }
  });

  // Conversation events endpoint (ordered by seq) — fetch by conversation_id
  app.get('/api/conversations/:id/events', (req: Request, res: Response) => {
    try {
      const conversationId = (req.params as any).id as string;
      const detail = getConversationById(conversationId);
      if (!detail) return res.status(404).json({ error: 'Not found' });
      const events = listConversationEvents(conversationId) as any[];
      const out = events.map((row: any) => ({
        id: row.id,
        conversation_id: conversationId,
        seq: row.seq,
        kind: row.kind,
        payload: (() => { try { return JSON.parse(row.payload_json || '{}'); } catch { return {}; } })(),
        created_at_ms: row.created_at_ms,
      }));
      if ((process.env.ITEMS_DEBUG || '').toLowerCase() === 'true') {
        try {
          const counts: Record<string, number> = {};
          for (const it of out) counts[it.kind] = (counts[it.kind] || 0) + 1;
          const seqs = out.map((i: any) => i.seq);
          const minSeq = Math.min(...seqs);
          const maxSeq = Math.max(...seqs);
          console.debug(`[events] conversation=${conversationId} total=${out.length} kinds=${JSON.stringify(counts)} seq=[${minSeq}..${maxSeq}]`);
        } catch {}
      }
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to get conversation events' });
    }
  });
}
