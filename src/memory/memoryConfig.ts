import * as fs from 'fs';
import * as path from 'path';

export type DeduplicationStrictnessConfig = 'exact' | 'normalized';

export interface MemoryConfig {
  retrieve_timeout_ms: number;
  extraction_model: string;
  /** Enable the memory deduplication pipeline (default: true) */
  dedup_enabled: boolean;
  /**
   * Number of conversation turns after which a surfaced memory item becomes
   * eligible for re-surfacing (default: 10)
   */
  dedup_expiry_turns: number;
  /**
   * Milliseconds after which a surfaced memory item becomes eligible for
   * re-surfacing (default: 1800000 = 30 min)
   */
  dedup_expiry_ms: number;
  /**
   * Matching strictness: 'exact' compares trimmed strings; 'normalized' also
   * lower-cases and strips punctuation (default: 'normalized')
   */
  dedup_strictness: DeduplicationStrictnessConfig;
  backend: 'mem0' | 'adaptive';
}

const DEFAULTS: MemoryConfig = {
  retrieve_timeout_ms: 1000,
  extraction_model: 'gpt-4o-mini',
  dedup_enabled: true,
  dedup_expiry_turns: 10,
  dedup_expiry_ms: 30 * 60 * 1000,
  dedup_strictness: 'normalized',
  backend: 'mem0',
};

const RUNTIME_DIR = process.env.RUNTIME_DATA_DIR
  ? path.resolve(process.env.RUNTIME_DATA_DIR)
  : path.join(__dirname, '..', '..', 'runtime-data');

const CONFIG_FILE = path.join(RUNTIME_DIR, 'memory-config.json');

let cached: MemoryConfig | null = null;

function loadFromDisk(): MemoryConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch (err) {
    console.warn('[memory-config] Failed to load from disk, using defaults', err);
  }
  return { ...DEFAULTS };
}

export function getMemoryConfig(): MemoryConfig {
  if (!cached) cached = loadFromDisk();
  return cached;
}

export function saveMemoryConfig(updates: Partial<MemoryConfig>): MemoryConfig {
  const current = getMemoryConfig();
  const next: MemoryConfig = {
    retrieve_timeout_ms: typeof updates.retrieve_timeout_ms === 'number'
      ? Math.max(100, Math.min(10000, updates.retrieve_timeout_ms))
      : current.retrieve_timeout_ms,
    extraction_model: typeof updates.extraction_model === 'string' && updates.extraction_model.trim()
      ? updates.extraction_model.trim()
      : current.extraction_model,
    dedup_enabled: typeof updates.dedup_enabled === 'boolean'
      ? updates.dedup_enabled
      : current.dedup_enabled,
    dedup_expiry_turns: typeof updates.dedup_expiry_turns === 'number'
      ? Math.max(1, updates.dedup_expiry_turns)
      : current.dedup_expiry_turns,
    dedup_expiry_ms: typeof updates.dedup_expiry_ms === 'number'
      ? Math.max(0, updates.dedup_expiry_ms)
      : current.dedup_expiry_ms,
    dedup_strictness: (updates.dedup_strictness === 'exact' || updates.dedup_strictness === 'normalized')
      ? updates.dedup_strictness
      : current.dedup_strictness,
    backend: updates.backend === 'adaptive' ? 'adaptive' : updates.backend === 'mem0' ? 'mem0' : current.backend,
  };
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
  cached = next;
  console.info('[memory-config] Saved to', CONFIG_FILE);
  return next;
}
