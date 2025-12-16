import { FunctionHandler } from "../../agentConfigs/types";
import { session, isOpen, jsonSend } from "../../session/state";

type NoiseMode = "normal" | "noisy";

// ===== Voice Noise Mode (runtime tuning) =====
// This tool is intended to be used mid-call to change how sensitive turn detection and
// barge-in (assistant interruption) are, especially in noisy environments.
//
// What this tool changes at runtime:
// - **Server-side barge-in logic** (authoritative in this repo):
//   We store `session.voiceTuning.bargeInGraceMs`, and `session/call.ts` reads it on each
//   `input_audio_buffer.speech_started` event to decide whether to truncate assistant audio.
//
// - **OpenAI Realtime turn detection** (best-effort):
//   If `session.modelConn` is open, we send a Realtime `session.update` with
//   `turn_detection` = `session.voiceTuning.turnDetection`. Most models apply this live,
//   but exact supported fields can vary; unsupported fields should be ignored safely.
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
// - **barge_in_grace_ms** (ms)
//   - Server-side grace period before we allow barge-in truncation after assistant audio starts.
//   - Higher = assistant is harder to interrupt (useful in noisy rooms).
//   - 0 = allow immediate interruption.
//   - Typical range: ~0 to ~1500.
//
// Quick validation (no noisy environment needed):
// - Set `barge_in_grace_ms` very high (e.g., 10000) and try speaking over the assistant.
//   The assistant should NOT be cut off for ~10 seconds.
// - Then set `barge_in_grace_ms` to 0 and repeat; it should cut off quickly.
//
// Notes:
// - This tool returns `applied_to_model` to indicate whether it sent a Realtime `session.update`.
// - The server-side barge-in change applies even if `applied_to_model` is false.

function toNumber(value: any): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function preset(mode: NoiseMode) {
  if (mode === "noisy") {
    return {
      turnDetection: {
        type: "server_vad",
        threshold: 0.78,
        prefix_padding_ms: 220,
        silence_duration_ms: 650,
      },
      bargeInGraceMs: 2000,
    };
  }

  return {
    turnDetection: {
      type: "server_vad",
      threshold: 0.6,
      prefix_padding_ms: 80,
      silence_duration_ms: 300,
    },
    bargeInGraceMs: 300,
  };
}

export const setVoiceNoiseModeTool: FunctionHandler = {
  schema: {
    name: "set_voice_noise_mode",
    type: "function",
    description:
      "Adjust voice turn-detection/barge-in behavior for noisy environments during an active call. Use mode='noisy' to reduce false interruptions from background noise, or mode='normal' to restore defaults.",
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
        barge_in_grace_ms: {
          type: "number",
          description:
            "Optional override: minimum assistant audio ms that must play before we allow truncation on speech_started.",
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
    const graceRaw = toNumber(args?.barge_in_grace_ms);

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

    const nextGraceMs =
      graceRaw !== undefined ? clamp(graceRaw, 0, 5000) : base.bargeInGraceMs;

    (session as any).voiceTuning = {
      mode,
      turnDetection: nextTurnDetection,
      bargeInGraceMs: nextGraceMs,
      updatedAtMs: Date.now(),
    };

    const canApplyToModel = isOpen(session.modelConn);
    if (canApplyToModel) {
      jsonSend(session.modelConn, {
        type: "session.update",
        session: {
          turn_detection: nextTurnDetection,
        },
      });
    }

    return {
      status: "ok",
      mode,
      applied_to_model: canApplyToModel,
      turn_detection: nextTurnDetection,
      barge_in_grace_ms: nextGraceMs,
    };
  },
};

export default setVoiceNoiseModeTool;
