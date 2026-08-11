export type InnerAwarenessMode = 'ambient' | 'next-turn' | 'wake' | 'interrupt';

export type InnerSignalInput = {
  id?: string;
  kind: string;
  source: string;
  awarenessMode: InnerAwarenessMode;
  priority?: number;
  payload: Record<string, unknown>;
  createdAtMs?: number;
};

export type InnerSignal = Required<Omit<InnerSignalInput, 'id' | 'priority' | 'createdAtMs'>> & {
  id: string;
  priority: number;
  createdAtMs: number;
  attempts: number;
};

export interface InnerSignalStore {
  publish(input: InnerSignalInput): { signal: InnerSignal; inserted: boolean };
  hasPendingWake(nowMs: number): boolean;
  nextPendingWakeAt(): number | undefined;
  claimBatch(nowMs: number, limit: number, leaseMs: number): InnerSignal[];
  claimForTurn(nowMs: number, limit: number, leaseMs: number): InnerSignal[];
  markHandled(ids: string[], handledAtMs: number): void;
  markFailed(ids: string[], error: string, availableAtMs: number): void;
}