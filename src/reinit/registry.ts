/**
 * Reinit registry — lets subsystems that init at server startup expose a
 * "reinitialise me" hook that runs when their watched config keys change.
 *
 * Wire-up: each subsystem calls `registerReinit(service, watchKeys, handler)`
 * once during boot. The config PUT route diffs changed keys and calls
 * `runReinitsForKeys(changedKeys)` afterwards, returning the results to the
 * client so the UI can surface success / failure inline.
 */

export type ReinitStatus = 'ok' | 'error' | 'skipped';

export interface ReinitResult {
  service: string;
  status: ReinitStatus;
  message?: string;
  /**
   * Keys the subsystem wants written back to config (e.g. the resolved repo
   * name after auto-create). The config route will persist these and include
   * them in the response so the settings UI updates.
   */
  updatedKeys?: Record<string, string>;
}

export type ReinitHandler = (changedKeys: string[]) => Promise<ReinitResult> | ReinitResult;

interface Registration {
  service: string;
  watchKeys: string[];
  handler: ReinitHandler;
}

const registrations: Registration[] = [];

export function registerReinit(service: string, watchKeys: string[], handler: ReinitHandler): void {
  registrations.push({ service, watchKeys: [...watchKeys], handler });
}

export async function runReinitsForKeys(changedKeys: string[]): Promise<ReinitResult[]> {
  if (changedKeys.length === 0) return [];
  const triggered = registrations.filter((r) =>
    r.watchKeys.some((k) => changedKeys.includes(k))
  );
  const results: ReinitResult[] = [];
  for (const reg of triggered) {
    const relevant = changedKeys.filter((k) => reg.watchKeys.includes(k));
    try {
      const result = await reg.handler(relevant);
      results.push(result);
    } catch (err: any) {
      results.push({
        service: reg.service,
        status: 'error',
        message: err?.message || String(err),
      });
    }
  }
  return results;
}

export function listRegisteredServices(): { service: string; watchKeys: string[] }[] {
  return registrations.map((r) => ({ service: r.service, watchKeys: [...r.watchKeys] }));
}
