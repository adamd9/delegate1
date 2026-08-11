import assert from 'assert';
import { InnerContextBroker } from '../../src/innerContext/broker';
import type { InnerSignal, InnerSignalInput, InnerSignalStore } from '../../src/innerContext/types';

type StoredSignal = InnerSignal & {
  status: 'pending' | 'claimed' | 'handled';
  availableAtMs: number;
  claimedAtMs?: number;
};

class FakeStore implements InnerSignalStore {
  readonly signals = new Map<string, StoredSignal>();

  publish(input: InnerSignalInput) {
    const id = input.id || `signal-${this.signals.size + 1}`;
    const existing = this.signals.get(id);
    if (existing) return { signal: existing, inserted: false };
    const signal: StoredSignal = {
      id,
      kind: input.kind,
      source: input.source,
      awarenessMode: input.awarenessMode,
      priority: input.priority || 0,
      payload: input.payload,
      createdAtMs: input.createdAtMs || 1,
      attempts: 0,
      status: 'pending',
      availableAtMs: input.createdAtMs || 1,
    };
    this.signals.set(id, signal);
    return { signal, inserted: true };
  }

  hasPendingWake(nowMs: number): boolean {
    return [...this.signals.values()].some(signal =>
      signal.status === 'pending'
      && signal.availableAtMs <= nowMs
      && (signal.awarenessMode === 'wake' || signal.awarenessMode === 'interrupt'));
  }

  nextPendingWakeAt(): number | undefined {
    const times = [...this.signals.values()]
      .filter(signal => signal.status === 'pending' && (signal.awarenessMode === 'wake' || signal.awarenessMode === 'interrupt'))
      .map(signal => signal.availableAtMs);
    return times.length ? Math.min(...times) : undefined;
  }

  claimBatch(nowMs: number, limit: number, leaseMs: number): InnerSignal[] {
    for (const signal of this.signals.values()) {
      if (signal.status === 'claimed' && (signal.claimedAtMs || 0) <= nowMs - leaseMs) {
        signal.status = 'pending';
        signal.claimedAtMs = undefined;
      }
    }
    if (!this.hasPendingWake(nowMs)) return [];
    const selected = [...this.signals.values()]
      .filter(signal => signal.status === 'pending' && signal.availableAtMs <= nowMs && signal.awarenessMode !== 'ambient')
      .sort((left, right) => right.priority - left.priority || left.createdAtMs - right.createdAtMs)
      .slice(0, limit);
    for (const signal of selected) {
      signal.status = 'claimed';
      signal.claimedAtMs = nowMs;
      signal.attempts += 1;
    }
    return selected;
  }

  claimForTurn(nowMs: number, limit: number, leaseMs: number): InnerSignal[] {
    const wakeId = '__turn_claim__';
    this.publish(signal(wakeId, 'wake', nowMs));
    const claimed = this.claimBatch(nowMs, limit, leaseMs).filter(item => item.id !== wakeId);
    this.signals.delete(wakeId);
    return claimed;
  }

  markHandled(ids: string[], _handledAtMs: number): void {
    for (const id of ids) this.signals.get(id)!.status = 'handled';
  }

  markFailed(ids: string[], _error: string, availableAtMs: number): void {
    for (const id of ids) {
      const signal = this.signals.get(id)!;
      signal.status = 'pending';
      signal.availableAtMs = availableAtMs;
      signal.claimedAtMs = undefined;
    }
  }
}

function signal(id: string, awarenessMode: InnerSignalInput['awarenessMode'], createdAtMs = 1): InnerSignalInput {
  return { id, kind: `test.${id}`, source: 'test', awarenessMode, payload: { id }, createdAtMs };
}

async function main() {
  let nowMs = 10_000;

  {
    const store = new FakeStore();
    const batches: string[][] = [];
    const broker = new InnerContextBroker(store, async batch => {
      batches.push(batch.map(item => item.id));
    }, () => true, { debounceMs: 60_000, maxBatchAgeMs: 60_000, now: () => nowMs });

    broker.publish(signal('next', 'next-turn'));
    broker.publish(signal('wake', 'wake'));
    const duplicate = broker.publish(signal('wake', 'wake'));
    await broker.flushNow();

    assert.strictEqual(duplicate.inserted, false);
    assert.deepStrictEqual(batches, [['next', 'wake']]);
    assert.strictEqual(store.signals.get('next')!.status, 'handled');
    broker.stop();
  }

  {
    const store = new FakeStore();
    const batches: string[][] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    const release = new Promise<void>(resolve => { releaseFirst = resolve; });
    const broker = new InnerContextBroker(store, async batch => {
      batches.push(batch.map(item => item.id));
      if (batches.length === 1) {
        firstStarted();
        await release;
      }
    }, () => true, { debounceMs: 60_000, maxBatchAgeMs: 60_000, now: () => nowMs });

    broker.publish(signal('first', 'wake'));
    const firstFlush = broker.flushNow();
    await started;
    broker.publish(signal('late', 'wake', 2));
    releaseFirst();
    await firstFlush;
    await broker.flushNow();

    assert.deepStrictEqual(batches, [['first'], ['late']]);
    broker.stop();
  }

  {
    const store = new FakeStore();
    let idle = false;
    let activations = 0;
    const broker = new InnerContextBroker(store, async () => { activations += 1; }, () => idle, {
      debounceMs: 60_000,
      maxBatchAgeMs: 60_000,
      idleRetryMs: 60_000,
      now: () => nowMs,
    });

    broker.publish(signal('deferred', 'wake'));
    await broker.flushNow();
    assert.strictEqual(activations, 0);
    assert.strictEqual(store.signals.get('deferred')!.status, 'pending');
    idle = true;
    await broker.flushNow();
    assert.strictEqual(activations, 1);
    broker.stop();
  }

  {
    const store = new FakeStore();
    let attempts = 0;
    const broker = new InnerContextBroker(store, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary failure');
    }, () => true, { debounceMs: 60_000, maxBatchAgeMs: 60_000, retryBaseMs: 1000, now: () => nowMs });

    broker.publish(signal('retry', 'wake'));
    await broker.flushNow();
    assert.strictEqual(store.signals.get('retry')!.status, 'pending');
    nowMs += 1000;
    await broker.flushNow();
    assert.strictEqual(attempts, 2);
    assert.strictEqual(store.signals.get('retry')!.status, 'handled');
    broker.stop();
  }

  console.log('inner-context broker tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
