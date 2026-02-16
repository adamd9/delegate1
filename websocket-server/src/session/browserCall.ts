import { RawData, WebSocket } from "ws";
import { getDefaultAgent, getAgent, FunctionHandler } from "../agentConfigs";
import { contextInstructions, Context, getTimeContext } from "../agentConfigs/context";
import { ensureSession, endSession, appendEvent } from "../observability/thoughtflow";
import { chatClients, logsClients } from "../ws/clients";
import {
  session,
  parseMessage,
  jsonSend,
  isOpen,
  closeAllConnections,
  closeModel,
} from "./state";
import { processRealtimeModelEvent, buildRealtimeSessionConfig } from "./call";
import { getChatVoiceConfig } from "../voice/voiceConfig";
import { getVoiceModePreset } from "../voice/voiceDefaults";

function logDroppingAudioIfNeeded() {
  const now = Date.now();
  const last = (session as any).lastBrowserDroppedAudioLogAtMs as number | undefined;
  if (typeof last === 'number' && now - last < 5000) return;
  (session as any).lastBrowserDroppedAudioLogAtMs = now;

  try {
    console.warn('[voice][audio] Dropping inbound browser audio because modelConn is not open', {
      modelReadyState: session.modelConn?.readyState,
      hasBrowserConn: !!session.browserConn,
      latestMediaTimestamp: session.latestMediaTimestamp,
      lastModelClose: (session as any).lastModelClose,
    });
  } catch {}
}

export function establishBrowserCallSocket(ws: WebSocket, openAIApiKey: string) {
  console.info("\ud83c\udf10 New browser voice connection");
  session.openAIApiKey = openAIApiKey;
  session.browserConn = ws;

  ws.on("message", (data) => processBrowserCallEvent(data));
  ws.on("error", (err) => {
    try {
      console.error('[ws][browser-call] websocket error', err);
    } catch {}
    try {
      ws.close();
    } catch {}
  });
  ws.on("close", (code: number, reason: Buffer) => {
    try {
      const r = reason?.toString?.() || '';
      console.warn('[ws][browser-call] websocket closed', { code, reason: r });
    } catch {}
    try {
      endSession();
    } catch {}
  });
}

export function processBrowserCallEvent(data: RawData) {
  const msg = parseMessage(data);
  if (!msg) return;

  switch (msg.event) {
    case "start": {
      console.info("\ud83c\udf10 Browser call started");
      session.latestMediaTimestamp = 0;
      session.lastAssistantItem = undefined;
      session.responseStartTimestamp = undefined;
      session.responseCumulativeAudioMs = undefined;

      try {
        ensureSession();
        try {
          (session as any).lastAssistantStepId = undefined;
        } catch {}
        try {
          (session as any).lastUserStepId = undefined;
        } catch {}
        const existingConv = (session as any).currentConversationId as string | undefined;
        if (!existingConv) {
          const convId = `conv_browser_${Date.now()}`;
          (session as any).currentConversationId = convId;
          appendEvent({
            type: "conversation.started",
            conversation_id: convId,
            channel: "voice",
            started_at: new Date().toISOString(),
          });
        }
      } catch {}

      establishBrowserRealtimeModelConnection();
      break;
    }
    case "media": {
      session.latestMediaTimestamp = msg.media?.timestamp;
      if (isOpen(session.modelConn)) {
        jsonSend(session.modelConn, {
          type: "input_audio_buffer.append",
          audio: msg.media?.payload,
        });
      } else {
        logDroppingAudioIfNeeded();
      }
      break;
    }
    case "voice_settings": {
      // Allow the browser UI to adjust voice tuning at runtime, using the same
      // mechanism as the set_voice_noise_mode agent tool.
      try {
        const settings = msg.settings || {};
        const mode = settings.mode === 'noisy' ? 'noisy' : 'normal';

        const toNumber = (v: any): number | undefined => {
          if (v === undefined || v === null || v === '') return undefined;
          const n = Number(v);
          return Number.isFinite(n) ? n : undefined;
        };
        const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

        // Build turn_detection from provided values (all optional, fall back to current/defaults)
        const current = (session as any).voiceTuning?.turnDetection || {};
        const persistedPreset = getVoiceModePreset(mode);
        const defaults = {
          type: persistedPreset.vad_type,
          threshold: persistedPreset.threshold,
          prefix_padding_ms: persistedPreset.prefix_padding_ms,
          silence_duration_ms: persistedPreset.silence_duration_ms,
        };

        const vadType = settings.vad_type || current.type || defaults.type;

        const thresholdVal = toNumber(settings.threshold);
        const prefixVal = toNumber(settings.prefix_padding_ms);
        const silenceVal = toNumber(settings.silence_duration_ms);

        // semantic_vad only accepts { type, eagerness? }; server_vad accepts { type, threshold, prefix_padding_ms, silence_duration_ms }
        const nextTurnDetection: any = vadType === 'none'
          ? { type: 'none' }
          : vadType === 'semantic_vad'
            ? { type: 'semantic_vad' }
            : {
                type: 'server_vad',
                threshold: thresholdVal !== undefined ? clamp(thresholdVal, 0, 1) : (current.threshold ?? defaults.threshold),
                prefix_padding_ms: prefixVal !== undefined ? clamp(prefixVal, 0, 2000) : (current.prefix_padding_ms ?? defaults.prefix_padding_ms),
                silence_duration_ms: silenceVal !== undefined ? clamp(silenceVal, 0, 5000) : (current.silence_duration_ms ?? defaults.silence_duration_ms),
              };

        (session as any).voiceTuning = {
          mode,
          turnDetection: nextTurnDetection,
          updatedAtMs: Date.now(),
        };

        // Push to OpenAI Realtime if connected
        if (isOpen(session.modelConn)) {
          jsonSend(session.modelConn, {
            type: 'session.update',
            session: { turn_detection: nextTurnDetection },
          });
        }

        // Ack back to browser
        if (isOpen(session.browserConn)) {
          jsonSend(session.browserConn, {
            event: 'voice_settings_ack',
            settings: {
              mode,
              turn_detection: nextTurnDetection,
              applied_to_model: isOpen(session.modelConn),
            },
          } as any);
        }

        console.info('[voice_settings] Updated from browser UI', {
          mode,
          turnDetection: nextTurnDetection,
        });
      } catch (err) {
        console.error('[voice_settings] Error applying settings', err);
      }
      break;
    }
    case "close": {
      console.info("\ud83c\udf10 Browser call closed");
      closeAllConnections();
      try {
        endSession();
      } catch {}
      break;
    }
  }
}

function establishBrowserRealtimeModelConnection() {
  const hasConnection = !!session.browserConn;
  if (!hasConnection || !session.openAIApiKey) return;
  if (isOpen(session.modelConn)) return;

  const voiceModel =
    getAgent("base").voiceModel ||
    getAgent("base").model ||
    "gpt-4o-realtime-preview-2024-12-17";

  session.modelConn = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${voiceModel}`,
    {
      headers: {
        Authorization: `Bearer ${session.openAIApiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  session.modelConn.on("open", () => {
    const sessionConfig = buildRealtimeSessionConfig('voice', 'pcm16');
    jsonSend(session.modelConn, {
      type: "session.update",
      session: sessionConfig,
    });

    if (session.browserConn) {
      jsonSend(session.modelConn, {
        type: "response.create",
        response: {
          instructions:
            "Greet briefly in a style that aligns with your given personality before awaiting input.",
        },
      });
    }
  });

  session.modelConn.on("message", (data: RawData) =>
    processRealtimeModelEvent(data, logsClients, chatClients)
  );
  session.modelConn.on("error", (err) => {
    try {
      console.error('[ws][openai-realtime] websocket error (browser-call)', err);
      (session as any).lastModelErrorAtMs = Date.now();
    } catch {}
    closeModel();
  });
  session.modelConn.on("close", (code: number, reason: Buffer) => {
    try {
      const r = reason?.toString?.() || '';
      (session as any).lastModelClose = { code, reason: r, atMs: Date.now(), source: 'browser-call' };
      console.warn('[ws][openai-realtime] websocket closed (browser-call)', { code, reason: r });
    } catch {}
    closeModel();
  });
}
