import * as fs from 'fs';
import * as path from 'path';

// ===== Persisted Voice Defaults =====
// Stores the default presets for "normal" and "noisy" voice modes.
// These are used as the base values by:
//   - call.ts / browserCall.ts when establishing a Realtime session
//   - voice-noise-mode.ts agent tool when applying a preset
//
// Persisted to runtime-data/voice-defaults.json so edits survive restarts.

export interface VoiceModePreset {
  vad_type: 'server_vad' | 'semantic_vad' | 'none';
  threshold: number;
  prefix_padding_ms: number;
  silence_duration_ms: number;
  barge_in_grace_ms: number;
}

export interface VoiceDefaultsConfig {
  normal: VoiceModePreset;
  noisy: VoiceModePreset;
}

const HARDCODED_DEFAULTS: VoiceDefaultsConfig = {
  normal: {
    vad_type: 'server_vad',
    threshold: 0.6,
    prefix_padding_ms: 80,
    silence_duration_ms: 300,
    barge_in_grace_ms: 300,
  },
  noisy: {
    vad_type: 'server_vad',
    threshold: 0.78,
    prefix_padding_ms: 220,
    silence_duration_ms: 650,
    barge_in_grace_ms: 2000,
  },
};

const RUNTIME_DIR = process.env.RUNTIME_DATA_DIR
  ? path.resolve(process.env.RUNTIME_DATA_DIR)
  : path.join(__dirname, '..', '..', 'runtime-data');

const DEFAULTS_FILE = path.join(RUNTIME_DIR, 'voice-defaults.json');

// In-memory cache (loaded once, updated on save)
let cached: VoiceDefaultsConfig | null = null;

function ensureDir() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

function loadFromDisk(): VoiceDefaultsConfig {
  try {
    if (fs.existsSync(DEFAULTS_FILE)) {
      const raw = fs.readFileSync(DEFAULTS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Merge with hardcoded defaults to fill any missing fields
      return {
        normal: { ...HARDCODED_DEFAULTS.normal, ...parsed.normal },
        noisy: { ...HARDCODED_DEFAULTS.noisy, ...parsed.noisy },
      };
    }
  } catch (err) {
    console.warn('[voice-defaults] Failed to load from disk, using hardcoded defaults', err);
  }
  return { ...HARDCODED_DEFAULTS };
}

/** Get the current voice defaults (cached, loaded from disk on first call). */
export function getVoiceDefaults(): VoiceDefaultsConfig {
  if (!cached) {
    cached = loadFromDisk();
  }
  return cached;
}

/** Get the preset for a specific mode. */
export function getVoiceModePreset(mode: 'normal' | 'noisy'): VoiceModePreset {
  return getVoiceDefaults()[mode];
}

/** Save new voice defaults to disk and update cache. */
export function saveVoiceDefaults(config: VoiceDefaultsConfig): void {
  ensureDir();
  // Validate and clamp
  const validated: VoiceDefaultsConfig = {
    normal: validatePreset(config.normal, HARDCODED_DEFAULTS.normal),
    noisy: validatePreset(config.noisy, HARDCODED_DEFAULTS.noisy),
  };
  fs.writeFileSync(DEFAULTS_FILE, JSON.stringify(validated, null, 2), 'utf-8');
  cached = validated;
  console.info('[voice-defaults] Saved to', DEFAULTS_FILE);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function validatePreset(input: Partial<VoiceModePreset>, fallback: VoiceModePreset): VoiceModePreset {
  const vadType = input.vad_type ?? fallback.vad_type;
  return {
    vad_type: ['server_vad', 'semantic_vad', 'none'].includes(vadType) ? vadType : fallback.vad_type,
    threshold: clamp(input.threshold ?? fallback.threshold, 0, 1),
    prefix_padding_ms: clamp(input.prefix_padding_ms ?? fallback.prefix_padding_ms, 0, 2000),
    silence_duration_ms: clamp(input.silence_duration_ms ?? fallback.silence_duration_ms, 0, 5000),
    barge_in_grace_ms: clamp(input.barge_in_grace_ms ?? fallback.barge_in_grace_ms, 0, 10000),
  };
}

/** Reset to hardcoded defaults (also removes the file). */
export function resetVoiceDefaults(): VoiceDefaultsConfig {
  try {
    if (fs.existsSync(DEFAULTS_FILE)) {
      fs.unlinkSync(DEFAULTS_FILE);
    }
  } catch {}
  cached = { ...HARDCODED_DEFAULTS };
  return cached;
}
