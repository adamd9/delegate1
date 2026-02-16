import { FunctionHandler } from "../../agentConfigs/types";
import { session, isOpen, jsonSend } from "../../session/state";
import { buildRealtimeSessionConfig, getAudioFormatForSession } from "../../session/call";

type NoiseMode = "normal" | "noisy";

// ===== Voice Noise Mode (runtime tuning) =====
// This tool is intended to be used mid-call to change how sensitive turn detection
// is, especially in noisy environments.
//
// What this tool changes at runtime:
// - **OpenAI Realtime turn detection**:
//   If `session.modelConn` is open, we send a Realtime `session.update` with
//   `turn_detection` = `session.voiceTuning.turnDetection`.
//
// Adjustable settings (presets + per-call overrides):
// - **mode**: "normal" | "noisy"
//   - Selects a baseline preset in `preset(mode)`.
//   - The caller may further override individual numeric fields below.
//
// - **threshold** (0..1)
//   - Higher = less sensitive VAD (fewer false starts from noise).
//   - Lower = more sensitive VAD (more responsive, but more noise-triggered turns).
//   - Typical range: ~0.5 to ~0.85.
//
// - **prefix_padding_ms** (ms)
//   - Minimum leading speech required before Realtime treats input as "speech started".
//   - Higher helps filter short noise blips; too high can clip the start of utterances.
//   - Typical range: ~50 to ~400.
//
// - **silence_duration_ms** (ms)
//   - How much silence is required before Realtime considers the user turn ended.
//   - Higher reduces choppy turn-taking; too high increases latency.
//   - Typical range: ~250 to ~1000.
//
// Notes:
// - This tool returns `applied_to_model` to indicate whether it sent a Realtime `session.update`.

function toNumber(value: any): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

import { getVoiceModePreset } from '../../voice/voiceDefaults';

function preset(mode: NoiseMode) {
  const p = getVoiceModePreset(mode);
  return {
    turnDetection: {
      type: p.vad_type,
      threshold: p.threshold,
      prefix_padding_ms: p.prefix_padding_ms,
      silence_duration_ms: p.silence_duration_ms,
    },
  };
}

export const setVoiceNoiseModeTool: FunctionHandler = {
  schema: {
    name: "set_voice_noise_mode",
    type: "function",
    description:
      "Adjust voice turn-detection behavior for noisy environments during an active call. Use mode='noisy' to reduce false interruptions from background noise, or mode='normal' to restore defaults.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["normal", "noisy"],
          description: "Target mode for voice turn detection.",
        },
        threshold: {
          type: "number",
          description:
            "Optional override for VAD threshold (0..1). Higher = less sensitive.",
        },
        prefix_padding_ms: {
          type: "number",
          description:
            "Optional override: ms of speech required before treating as speech start.",
        },
        silence_duration_ms: {
          type: "number",
          description:
            "Optional override: ms of silence required before ending a user turn.",
        },
      },
      required: ["mode"],
      additionalProperties: false,
    },
  },

  handler: async (args: any) => {
    const mode = (args?.mode === "noisy" ? "noisy" : "normal") as NoiseMode;
    const base = preset(mode);

    const thresholdRaw = toNumber(args?.threshold);
    const prefixRaw = toNumber(args?.prefix_padding_ms);
    const silenceRaw = toNumber(args?.silence_duration_ms);

    const nextTurnDetection: any = {
      ...base.turnDetection,
      ...(thresholdRaw !== undefined
        ? { threshold: clamp(thresholdRaw, 0.0, 1.0) }
        : {}),
      ...(prefixRaw !== undefined
        ? { prefix_padding_ms: clamp(prefixRaw, 0, 2000) }
        : {}),
      ...(silenceRaw !== undefined
        ? { silence_duration_ms: clamp(silenceRaw, 0, 5000) }
        : {}),
    };

    (session as any).voiceTuning = {
      mode,
      turnDetection: nextTurnDetection,
      updatedAtMs: Date.now(),
    };

    const canApplyToModel = isOpen(session.modelConn);
    if (canApplyToModel) {
      // Detect audio format based on connection type and send complete session config
      const audioFormat = getAudioFormatForSession();
      const fullSessionConfig = buildRealtimeSessionConfig('voice', audioFormat);
      jsonSend(session.modelConn, {
        type: "session.update",
        session: fullSessionConfig,
      });
    }

    return {
      status: "ok",
      mode,
      applied_to_model: canApplyToModel,
      turn_detection: nextTurnDetection,
    };
  },
};

export default setVoiceNoiseModeTool;
