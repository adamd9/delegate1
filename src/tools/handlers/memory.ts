import { FunctionHandler } from '../../agentConfigs/types';
import { getMemoryBackend } from '../../memory/backends';
import { getMemoryConfig } from '../../memory/memoryConfig';

function getAdaptiveBackend(): { backend: any } | { error: string } {
  if (getMemoryConfig().backend !== 'adaptive') {
    return { error: 'retrieve_memory is only available with the adaptive memory backend. Switch to adaptive in Settings → Memory.' };
  }
  const backend = getMemoryBackend();
  if (!('retrieveExplicit' in backend)) {
    return { error: 'retrieve_memory is only available with the adaptive memory backend. Set MEMORY_BACKEND=adaptive.' };
  }
  return { backend };
}

export const retrieveMemoryFunction: FunctionHandler = {
  schema: {
    name: 'retrieve_memory',
    type: 'function',
    description: 'Explicitly retrieve memories by query with full scoring details.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant memories',
        },
        top_k: {
          type: 'number',
          description: 'Maximum number of memories to return (default: 5)',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  handler: async (args: { query: string; top_k?: number }) => {
    try {
      const result = getAdaptiveBackend();
      if ('error' in result) return { error: result.error };

      const memories = await result.backend.retrieveExplicit(args.query, args.top_k);
      return memories;
    } catch (e: any) {
      return { error: e?.message ?? 'Failed to retrieve memories' };
    }
  },
};

export const storeMemoryFunction: FunctionHandler = {
  schema: {
    name: 'store_memory',
    type: 'function',
    description: 'Explicitly store a memory with consolidation and conflict detection.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The memory/fact to store',
        },
        override: {
          type: 'boolean',
          description: 'Set to true to force-store even if a conflict is detected with an existing memory',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  handler: async (args: { content: string; override?: boolean }) => {
    try {
      const result = getAdaptiveBackend();
      if ('error' in result) return { error: result.error };

      const storeResult = await result.backend.storeExplicit(args.content, args.override ?? false);

      if (storeResult.type === 'conflict') {
        return storeResult;
      }

      return { status: storeResult.type, memoryId: storeResult.memoryId };
    } catch (e: any) {
      return { error: e?.message ?? 'Failed to store memory' };
    }
  },
};
