import type { InnerSignal, InnerSignalInput, InnerSignalStore } from './types';

export type InnerContextBrokerOptions = {
  debounceMs?: number;
  maxBatchAgeMs?: number;
  idleRetryMs?: number;
  retryBaseMs?: number;
  leaseMs?: number;
  batchLimit?: number;
  now?: () => number;
};

export type InnerContextActivator = (signals: InnerSignal[]) => Promise<void>;

export class InnerContextBroker {
  private readonly debounceMs: number;
  private readonly maxBatchAgeMs: number;
  private readonly idleRetryMs: number;
  private readonly retryBaseMs: number;
  private readonly leaseMs: number;
  private readonly batchLimit: number;
  private readonly now: () => number;
  private timer?: NodeJS.Timeout;
  private firstWakeAt?: number;
  private running = false;

  constructor(
    private readonly store: InnerSignalStore,
    private readonly activate: InnerContextActivator,
    private readonly isIdle: () => boolean,
    options: InnerContextBrokerOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 500;
    this.maxBatchAgeMs = options.maxBatchAgeMs ?? 2000;
    this.idleRetryMs = options.idleRetryMs ?? 1000;
    this.retryBaseMs = options.retryBaseMs ?? 1000;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.batchLimit = options.batchLimit ?? 20;
    this.now = options.now ?? Date.now;
  }

  publish(input: InnerSignalInput): { signal: InnerSignal; inserted: boolean } {
    const result = this.store.publish(input);
    if (input.awarenessMode === 'wake' || input.awarenessMode === 'interrupt') {
      this.schedule(this.debounceMs);
    }
    return result;
  }

  start(): void {
    this.scheduleNextPending();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.firstWakeAt = undefined;
  }

  async flushNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.processPending();
  }

  private schedule(delayMs: number): void {
    const now = this.now();
    if (this.firstWakeAt === undefined) this.firstWakeAt = now;
    if (this.running) return;

    const hardDeadline = this.firstWakeAt + this.maxBatchAgeMs;
    const effectiveDelay = Math.max(0, Math.min(delayMs, hardDeadline - now));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.processPending();
    }, effectiveDelay);
    this.timer.unref?.();
  }

  private async processPending(): Promise<void> {
    if (this.running) return;
    if (!this.isIdle()) {
      this.firstWakeAt = this.now();
      this.schedule(this.idleRetryMs);
      return;
    }

    this.running = true;
    this.firstWakeAt = undefined;
    const signals = this.store.claimBatch(this.now(), this.batchLimit, this.leaseMs);
    if (!signals.length) {
      this.running = false;
      this.firstWakeAt = undefined;
      this.scheduleNextPending();
      return;
    }

    const ids = signals.map(signal => signal.id);
    try {
      await this.activate(signals);
      this.store.markHandled(ids, this.now());
    } catch (error) {
      const attempts = Math.max(...signals.map(signal => signal.attempts));
      const retryDelay = Math.min(60_000, this.retryBaseMs * (2 ** Math.max(0, attempts - 1)));
      const message = error instanceof Error ? error.message : String(error);
      this.store.markFailed(ids, message, this.now() + retryDelay);
      console.error('[inner-context] Batch activation failed:', message);
    } finally {
      this.running = false;
      this.scheduleNextPending();
    }
  }

  private scheduleNextPending(): void {
    const nextWakeAt = this.store.nextPendingWakeAt();
    if (nextWakeAt === undefined) return;
    if (nextWakeAt > this.now()) this.firstWakeAt = nextWakeAt;
    this.schedule(Math.max(this.debounceMs, nextWakeAt - this.now()));
  }
}