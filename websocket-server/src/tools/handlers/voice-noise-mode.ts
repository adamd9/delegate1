import { FunctionHandler } from "../../agentConfigs/types";
import { session, isOpen, jsonSend } from "../../session/state";

type NoiseMode = "normal" | "noisy";

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
      bargeInGraceMs: 900,
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
