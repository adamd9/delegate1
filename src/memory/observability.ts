type MemoryEventType =
  | 'retrieve.cache_hit'
  | 'retrieve.cache_bust'
  | 'retrieve.timeout'
  | 'retrieve.miss'
  | 'retrieve.fresh'
  | 'retrieve.late'
  | 'retrieve.late_suppressed'
  | 'extract.start'
  | 'extract.none'
  | 'extract.stored'
  | 'extract.error'
  | 'arbitrator.result'
  | 'arbitrator.error'
  | 'consolidation.new'
  | 'consolidation.consolidated'
  | 'consolidation.conflict'
  | 'consolidation.override';

export interface MemoryRuntimeEvent {
  type: MemoryEventType;
  timestamp: number;
  conversationId?: string;
  channel?: string;
  details?: Record<string, unknown>;
}

const MAX_EVENTS = 400;
const runtimeEvents: MemoryRuntimeEvent[] = [];
const listeners = new Set<(event: MemoryRuntimeEvent) => void>();

function trimEvents() {
  if (runtimeEvents.length <= MAX_EVENTS) return;
  runtimeEvents.splice(0, runtimeEvents.length - MAX_EVENTS);
}

export function recordMemoryRuntimeEvent(event: Omit<MemoryRuntimeEvent, 'timestamp'> & { timestamp?: number }): void {
  const recorded = { ...event, timestamp: event.timestamp ?? Date.now() } as MemoryRuntimeEvent;
  runtimeEvents.push(recorded);
  trimEvents();
  for (const listener of listeners) {
    try { listener(recorded); } catch (error) {
      console.warn('[memory] runtime event listener failed:', error instanceof Error ? error.message : error);
    }
  }
}

export function onMemoryRuntimeEvent(listener: (event: MemoryRuntimeEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMemoryRuntimeEvents(limit = 100): MemoryRuntimeEvent[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit || 100)));
  const start = Math.max(0, runtimeEvents.length - safeLimit);
  return runtimeEvents.slice(start).reverse();
}

export function getMemoryRuntimeStats() {
  const counters: Record<string, number> = {};
  for (const evt of runtimeEvents) counters[evt.type] = (counters[evt.type] || 0) + 1;

  return {
    buffer_size: runtimeEvents.length,
    max_buffer_size: MAX_EVENTS,
    counters,
    last_event_at: runtimeEvents.length > 0 ? runtimeEvents[runtimeEvents.length - 1].timestamp : null,
  };
}
