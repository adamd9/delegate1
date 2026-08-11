import type { MemoryRuntimeEvent } from '../memory/observability';
import type { InnerSignalInput } from './types';

export function memoryEventToInnerSignal(event: MemoryRuntimeEvent): InnerSignalInput | undefined {
  if (!event.type.startsWith('consolidation.') || event.type === 'consolidation.new') return undefined;
  const memoryId = typeof event.details?.memory_id === 'string' ? event.details.memory_id : 'unknown';
  return {
    id: `memory:${event.type}:${memoryId}:${event.timestamp}`,
    kind: `memory.${event.type.slice('consolidation.'.length)}`,
    source: 'memory.consolidation',
    awarenessMode: 'wake',
    priority: event.type === 'consolidation.conflict' ? 30 : 20,
    createdAtMs: event.timestamp,
    payload: {
      memoryId,
      outcome: event.type.slice('consolidation.'.length),
      ...(event.conversationId ? { conversationId: event.conversationId } : {}),
      ...(event.channel ? { channel: event.channel } : {}),
      ...(event.details || {}),
    },
  };
}