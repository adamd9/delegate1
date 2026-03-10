import * as fs from 'fs';
import * as path from 'path';

export interface MemoryConfig {
  retrieve_timeout_ms: number;
  extraction_model: string;
}

const DEFAULTS: MemoryConfig = {
  retrieve_timeout_ms: 1000,
  extraction_model: 'gpt-4o-mini',
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
  };
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
  cached = next;
  console.info('[memory-config] Saved to', CONFIG_FILE);
  return next;
}
