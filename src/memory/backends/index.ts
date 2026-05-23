import type { MemoryBackend } from '../types';
import { AdaptiveMemoryBackend } from './adaptive';

let _backend: MemoryBackend | null = null;

/** Returns the singleton native adaptive memory backend. */
export function getMemoryBackend(): MemoryBackend {
  if (_backend) return _backend;

  _backend = new AdaptiveMemoryBackend();
  console.log('[memory] Backend: Adaptive');
  return _backend;
}

/** Reset the cached backend so the next call to getMemoryBackend() re-reads config */
export function resetMemoryBackend(): void {
  _backend = null;
  console.log('[memory] Backend reset — will re-initialize on next call');
}
