import type { MemoryBackend } from '../types';
import { Mem0Backend } from './mem0';

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
  if (process.env.MEM0_API_KEY) {
    _backend = new Mem0Backend();
    console.log('[memory] Backend: Mem0 (MEM0_API_KEY present)');
  } else {
    _backend = new NullBackend();
    console.log('[memory] Backend: none (MEM0_API_KEY not set) — all memory ops are no-ops');
  }
  return _backend;
}
