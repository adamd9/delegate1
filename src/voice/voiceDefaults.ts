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
  eagerness?: 'low' | 'medium' | 'high' | 'auto';
}

export interface VoiceDefaultsConfig {
  normal: VoiceModePreset;
  noisy: VoiceModePreset;
  semantic_high: VoiceModePreset;
  semantic_medium: VoiceModePreset;
}

const HARDCODED_DEFAULTS: VoiceDefaultsConfig = {
  normal: {
    vad_type: 'server_vad',
    threshold: 0.97,
    prefix_padding_ms: 290,
    silence_duration_ms: 1330,
    eagerness: 'auto',
  },
  noisy: {
    vad_type: 'server_vad',
    threshold: 0.99,
    prefix_padding_ms: 220,
    silence_duration_ms: 1310,
    eagerness: 'low',
  },
  semantic_high: {
    vad_type: 'semantic_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 500,
    eagerness: 'high',
  },
  semantic_medium: {
    vad_type: 'semantic_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 500,
    eagerness: 'auto',
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
        semantic_high: { ...HARDCODED_DEFAULTS.semantic_high, ...parsed.semantic_high },
        semantic_medium: { ...HARDCODED_DEFAULTS.semantic_medium, ...parsed.semantic_medium },
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
export function getVoiceModePreset(mode: 'normal' | 'noisy' | 'semantic_high' | 'semantic_medium'): VoiceModePreset {
  return getVoiceDefaults()[mode];
}

/** Save new voice defaults to disk and update cache. */
export function saveVoiceDefaults(config: VoiceDefaultsConfig): void {
  ensureDir();
  // Validate and clamp
  const validated: VoiceDefaultsConfig = {
    normal: validatePreset(config.normal, HARDCODED_DEFAULTS.normal),
    noisy: validatePreset(config.noisy, HARDCODED_DEFAULTS.noisy),
    semantic_high: validatePreset(config.semantic_high, HARDCODED_DEFAULTS.semantic_high),
    semantic_medium: validatePreset(config.semantic_medium, HARDCODED_DEFAULTS.semantic_medium),
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
  const eagerness = input.eagerness ?? fallback.eagerness;
  return {
    vad_type: ['server_vad', 'semantic_vad', 'none'].includes(vadType) ? vadType : fallback.vad_type,
    threshold: clamp(input.threshold ?? fallback.threshold, 0, 1),
    prefix_padding_ms: clamp(input.prefix_padding_ms ?? fallback.prefix_padding_ms, 0, 2000),
    silence_duration_ms: clamp(input.silence_duration_ms ?? fallback.silence_duration_ms, 0, 5000),
    eagerness: eagerness && ['low', 'medium', 'high', 'auto'].includes(eagerness) ? eagerness : fallback.eagerness,
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
