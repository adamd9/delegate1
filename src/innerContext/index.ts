import { session } from '../session/state';
import { isOpen, jsonSend } from '../session/state';
import { addConversationEvent } from '../db/sqlite';
import { injectMessage } from '../services/agentBridge';
import { onMemoryRuntimeEvent } from '../memory/observability';
import { chatClients } from '../ws/clients';
import { InnerContextBroker } from './broker';
import { formatInnerContext } from './format';
import { memoryEventToInnerSignal } from './memorySignals';
import { SqliteInnerSignalStore } from './store';
import type { InnerSignal, InnerSignalInput } from './types';

const store = new SqliteInnerSignalStore();
let stopMemoryEvents: (() => void) | undefined;

function broadcast(event: Record<string, unknown>): void {
  for (const ws of chatClients) {
    if (isOpen(ws)) jsonSend(ws, event);
  }
}

export const innerContextBroker = new InnerContextBroker(
  store,
  async signals => {
    const timestamp = Date.now();
    const signalDetails = signals.map(signal => ({
      id: signal.id,
      kind: signal.kind,
      source: signal.source,
      awarenessMode: signal.awarenessMode,
      priority: signal.priority,
      payload: signal.payload,
      createdAtMs: signal.createdAtMs,
      attempts: signal.attempts,
    }));
    console.log(`[inner-context] activating batch size=${signals.length} signals=${signals.map(signal => signal.kind).join(',')}`);
    broadcast({ type: 'inner.activation', phase: 'started', signals: signalDetails, timestamp });
    try {
      const result = await injectMessage({
        message: formatInnerContext(signals),
        channel: 'agent',
        metadata: { innerSignals: signalDetails, innerActivationStartedAt: timestamp },
        opts: { innerContext: true },
      });
      if (!result) throw new Error('Base-agent activation did not complete');
      addConversationEvent({
        conversation_id: result.conversationId,
        kind: 'inner_activation_completed',
        payload: { signals: signalDetails, duration_ms: Date.now() - timestamp },
      });
      console.log(`[inner-context] completed batch size=${signals.length}`);
      broadcast({ type: 'inner.activation', phase: 'completed', signals: signalDetails, duration_ms: Date.now() - timestamp, timestamp: Date.now() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const conversationId = (session as any).currentConversationId as string | undefined;
      if (conversationId) {
        try {
          addConversationEvent({
            conversation_id: conversationId,
            kind: 'inner_activation_failed',
            payload: { signals: signalDetails, error: message, duration_ms: Date.now() - timestamp },
          });
        } catch {}
      }
      broadcast({ type: 'inner.activation', phase: 'failed', signals: signalDetails, error: message, timestamp: Date.now() });
      throw error;
    }
  },
  () => !session.currentRequest
    && !session.responseStartTimestamp
    && !session.waitingForTool
    && !session.twilioConn
    && !session.browserConn
    && !session.modelConn,
);

export function publishInnerSignal(input: InnerSignalInput) {
  const result = innerContextBroker.publish(input);
  console.log(`[inner-context] ${result.inserted ? 'published' : 'deduplicated'} id=${result.signal.id} kind=${result.signal.kind} source=${result.signal.source} mode=${result.signal.awarenessMode}`);
  if (result.inserted) {
    const signalEvent = {
      id: result.signal.id,
      kind: result.signal.kind,
      source: result.signal.source,
      awarenessMode: result.signal.awarenessMode,
      priority: result.signal.priority,
      payload: result.signal.payload,
      createdAtMs: result.signal.createdAtMs,
    };
    const conversationId = session.currentConversationId;
    if (conversationId) {
      try {
        addConversationEvent({
          conversation_id: conversationId,
          kind: 'inner_signal_published',
          payload: { signal: signalEvent },
          created_at_ms: result.signal.createdAtMs,
        });
      } catch {}
    }
    broadcast({
      type: 'inner.signal',
      signal: signalEvent,
      timestamp: result.signal.createdAtMs,
    });
  }
  return result;
}

export function startInnerContextPlane(): void {
  if (!stopMemoryEvents) {
    stopMemoryEvents = onMemoryRuntimeEvent(event => {
      const signal = memoryEventToInnerSignal(event);
      if (signal) publishInnerSignal(signal);
    });
  }
  innerContextBroker.start();
}

export function stopInnerContextPlane(): void {
  stopMemoryEvents?.();
  stopMemoryEvents = undefined;
  innerContextBroker.stop();
}

export type { InnerAwarenessMode, InnerSignal, InnerSignalInput } from './types';

export type TimerWakeInput = {
  timerId: string;
  name: string;
  dueAtMs: number;
  recurrence?: string;
  purpose?: string;
  metadata?: Record<string, unknown>;
};

export function publishTimerWake(input: TimerWakeInput) {
  return publishInnerSignal({
    id: `timer:${input.timerId}:${input.dueAtMs}`,
    kind: 'timer.due',
    source: 'timer',
    awarenessMode: 'wake',
    priority: 10,
    createdAtMs: input.dueAtMs,
    payload: {
      timerId: input.timerId,
      name: input.name,
      dueAt: new Date(input.dueAtMs).toISOString(),
      ...(input.recurrence ? { recurrence: input.recurrence } : {}),
      ...(input.purpose ? { purpose: input.purpose } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  });
}