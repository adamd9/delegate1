import { session } from '../session/state';
import { injectMessage } from '../services/agentBridge';
import { InnerContextBroker } from './broker';
import { formatInnerContext } from './format';
import { SqliteInnerSignalStore } from './store';
import type { InnerSignal, InnerSignalInput } from './types';

const store = new SqliteInnerSignalStore();

export const innerContextBroker = new InnerContextBroker(
  store,
  async signals => {
    const result = await injectMessage({
      message: formatInnerContext(signals),
      channel: 'agent',
      opts: { innerContext: true },
    });
    if (!result) throw new Error('Base-agent activation did not complete');
  },
  () => !session.currentRequest
    && !session.responseStartTimestamp
    && !session.waitingForTool
    && !session.twilioConn
    && !session.browserConn
    && !session.modelConn,
);

export function publishInnerSignal(input: InnerSignalInput) {
  return innerContextBroker.publish(input);
}

export function startInnerContextPlane(): void {
  innerContextBroker.start();
}

export function stopInnerContextPlane(): void {
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