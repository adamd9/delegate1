import type { MemoryBackend } from '../types';
import { Mem0Backend } from './mem0';
import { AdaptiveMemoryBackend } from './adaptive';
import { getMemoryConfig } from '../memoryConfig';

/** No-op backend used when no memory provider is configured */
class NullBackend implements MemoryBackend {
  readonly available = false;
  async retrieve(): Promise<null> { return null; }
  async add(): Promise<void> {}
}

let _backend: MemoryBackend | null = null;

/** Returns the configured memory backend, or a no-op backend if none is available. */
export function getMemoryBackend(): MemoryBackend {
  if (_backend) return _backend;

  const config = getMemoryConfig();
  const selected = config.backend || 'mem0';

  if (selected === 'adaptive') {
    _backend = new AdaptiveMemoryBackend();
    console.log('[memory] Backend: Adaptive');
  } else if (process.env.MEM0_API_KEY) {
    _backend = new Mem0Backend();
    console.log('[memory] Backend: Mem0');
  } else {
    _backend = new NullBackend();
    console.log('[memory] Backend: none (no memory backend configured) — all memory ops are no-ops');
  }
  return _backend;
}

/** Reset the cached backend so the next call to getMemoryBackend() re-reads config */
export function resetMemoryBackend(): void {
  _backend = null;
  console.log('[memory] Backend reset — will re-initialize on next call');
}
