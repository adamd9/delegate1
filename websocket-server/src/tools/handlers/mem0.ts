import { FunctionHandler } from '../../agentConfigs/types';

// Minimal shapes to avoid hard typing dependency
interface Mem0Message { role: 'user' | 'assistant'; content: string }

async function getClient() {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) throw new Error('MEM0_API_KEY is not set');
  // Dynamic import to avoid load if unused or missing dep during dev
  const mod: any = await import('mem0ai');
  const MemoryClient = mod?.default || mod?.MemoryClient || mod;
  return new MemoryClient(apiKey);
}

export const memAddFunction: FunctionHandler = {
  schema: {
    name: 'mem_add',
    type: 'function',
    description: 'Store durable memory fact(s). Treat all interactions as the same global user. Optionally include channel metadata.',
    parameters: {
      type: 'object',
      properties: {
        // Either provide text (stored as a single user message) or messages array
        text: { type: 'string', description: 'A single user fact/preference to store.' },
        messages: {
          type: 'array',
          description: 'Explicit message pairs to store (user/assistant).',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' }
            },
            required: ['role', 'content'],
            additionalProperties: false
          }
        },
        channel: { type: 'string', description: 'Optional channel (e.g., web, sms) for metadata only.' },
        metadata: { type: 'object', description: 'Optional additional metadata to attach.' }
      },
      required: [],
      additionalProperties: false
    }
  },
  handler: async (args) => {
    const client = await getClient();
    const messages: Mem0Message[] = Array.isArray(args?.messages) && args.messages.length
      ? args.messages
      : (args?.text ? [{ role: 'user', content: String(args.text) }] : []);
    if (!messages.length) return JSON.stringify({ error: 'Provide text or messages' });

    const metadata = { ...(args?.metadata || {}) } as Record<string, any>;
    if (args?.channel) metadata.channel = args.channel;

    const options = { user_id: 'global', metadata } as any; // single global user scope
    try {
      const res = await client.add(messages, options);
      return typeof res === 'string' ? res : JSON.stringify(res);
    } catch (e: any) {
      return JSON.stringify({ error: e?.message || 'mem add failed' });
    }
  }
};

export const memSearchFunction: FunctionHandler = {
  schema: {
    name: 'mem_search',
    type: 'function',
    description: 'Search durable memories for relevant facts/preferences. Global user scope.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for (semantic).'},
        limit: { type: 'number', description: 'Max number of results to return', default: 5 },
        metadata: { type: 'object', description: 'Optional metadata filters (depends on Mem0 server capabilities).'}
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  handler: async (args) => {
    const client = await getClient();
    const query = String(args?.query || '').trim();
    if (!query) return JSON.stringify({ error: 'query is required' });
    const limit = typeof args?.limit === 'number' ? args.limit : 5;
    const options = { user_id: 'global', limit, ...(args?.metadata ? { metadata: args.metadata } : {}) } as any;
    try {
      const res = await client.search(query, options);
      return typeof res === 'string' ? res : JSON.stringify(res);
    } catch (e: any) {
      return JSON.stringify({ error: e?.message || 'mem search failed' });
    }
  }
};
