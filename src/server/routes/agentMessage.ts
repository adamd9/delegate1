import type { Application, Request, Response } from 'express';
import { injectMessage } from '../../services/agentBridge';

export type AgentMessagePriority = 'normal' | 'high' | 'low';

export type AgentMessagePayload = {
  message: string;
  sender: string;
  source?: string;
  priority?: AgentMessagePriority;
  metadata?: Record<string, unknown>;
};

type AgentMessageRouteOptions = {
  path?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getConversationId(metadata?: Record<string, unknown>): string | undefined {
  return typeof metadata?.conversationId === 'string' ? metadata.conversationId : undefined;
}

export function formatAgentMessage({ message, sender, source, priority }: AgentMessagePayload): string {
  const contextParts = [`sender: ${sender}`];
  if (source) contextParts.push(`source: ${source}`);
  if (priority) contextParts.push(`priority: ${priority}`);
  return `[EXTERNAL AGENT MESSAGE — ${contextParts.join(', ')}]\n\n${message}`;
}

export function parseAgentMessagePayload(body: unknown): { ok: true; data: AgentMessagePayload } | { ok: false; error: string } {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Request body must be an object' };
  }

  const { message, sender, source, priority, metadata } = body;

  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, error: 'message is required' };
  }
  if (typeof sender !== 'string' || !sender.trim()) {
    return { ok: false, error: 'sender is required' };
  }
  if (source !== undefined && typeof source !== 'string') {
    return { ok: false, error: 'source must be a string' };
  }
  if (priority !== undefined && priority !== 'normal' && priority !== 'high' && priority !== 'low') {
    return { ok: false, error: 'priority must be one of: normal, high, low' };
  }
  if (metadata !== undefined && !isPlainObject(metadata)) {
    return { ok: false, error: 'metadata must be an object' };
  }

  return {
    ok: true,
    data: {
      message: message.trim(),
      sender: sender.trim(),
      ...(source ? { source: source.trim() } : {}),
      ...(priority ? { priority } : {}),
      ...(metadata ? { metadata } : {}),
    },
  };
}

export async function deliverAgentMessage(payload: AgentMessagePayload) {
  return injectMessage({
    message: formatAgentMessage(payload),
    channel: 'agent',
    metadata: payload.metadata,
    opts: { conversationId: getConversationId(payload.metadata) },
  });
}

export function registerAgentMessageRoutes(app: Application, options: AgentMessageRouteOptions = {}) {
  const path = options.path || '/api/agent/message';

  app.post(path, async (req: Request, res: Response) => {
    const parsed = parseAgentMessagePayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    try {
      const result = await deliverAgentMessage(parsed.data);
      res.json({ ok: true, result });
    } catch (err: any) {
      console.error('[agent-message] Failed to inject message:', err);
      res.status(500).json({ error: err?.message || 'Failed to inject message' });
    }
  });
}
