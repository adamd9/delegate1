import { FunctionHandler } from '../../agentConfigs/types';
import { listAdaptations, getAdaptation, updateAdaptation, reloadAdaptations } from '../../adaptations';

export const listAdaptationsFunction: FunctionHandler = {
  schema: {
    name: 'list_adaptations',
    type: 'function',
    description: 'List Prompt Adaptations available for this project. Optionally filter by agent/channel/tags/enabled.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['base', 'supervisor'] },
        channel: { type: 'string', enum: ['text', 'voice', 'sms', 'email'] },
        tags: { type: 'array', items: { type: 'string' } },
        enabled: { type: 'boolean' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  handler: async (args: { agent?: 'base' | 'supervisor'; channel?: 'text' | 'voice' | 'sms' | 'email'; tags?: string[]; enabled?: boolean; }) => {
    const items = await listAdaptations(args);
    return { items: items.map(i => ({ id: i.id, title: i.title, description: i.description, enabled: i.enabled !== false, scope: i.scope, tags: i.tags })) };
  },
};

export const getAdaptationFunction: FunctionHandler = {
  schema: {
    name: 'get_adaptation',
    type: 'function',
    description: 'Get a single Prompt Adaptation by id (resolved with current edits).',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  handler: async (args: { id: string }) => {
    const item = await getAdaptation(args.id);
    if (!item) return { error: 'not_found' };
    return { item };
  },
};

export const updateAdaptationFunction: FunctionHandler = {
  schema: {
    name: 'update_adaptation',
    type: 'function',
    description: 'Update a Prompt Adaptation content/title/enabled by id (fixed id set; no add/delete).',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  handler: async (args: { id: string; title?: string; content?: string; enabled?: boolean }) => {
    const item = await updateAdaptation(args.id, { title: args.title, content: args.content, enabled: args.enabled });
    if (!item) return { error: 'not_found' };
    return { status: 'updated', item };
  },
};

export const reloadAdaptationsFunction: FunctionHandler = {
  schema: {
    name: 'reload_adaptations',
    type: 'function',
    description: 'Reload Prompt Adaptations edits from disk into memory (hot reload).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  handler: async () => {
    const { version } = await reloadAdaptations();
    return { status: 'reloaded', version };
  },
};
