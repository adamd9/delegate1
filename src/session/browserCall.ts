import { RawData, WebSocket } from "ws";
import { getDefaultAgent, getAgent, FunctionHandler } from "../agentConfigs";
import { contextInstructions, Context, getTimeContext } from "../agentConfigs/context";
import { ensureSession, appendEvent } from "../observability/thoughtflow";
import { chatClients, logsClients } from "../ws/clients";
import {
  session,
  parseMessage,
  jsonSend,
  isOpen,
  closeAllConnections,
  closeModel,
} from "./state";
import { processRealtimeModelEvent, buildRealtimeSessionConfig, sendVoiceSessionRecycleCue } from "./call";
import { getChatVoiceConfig } from "../voice/voiceConfig";
import { classifyOpenAIError } from "../services/openaiErrors";
import { getVoiceModePreset } from "../voice/voiceDefaults";
import { configService } from "../config";
import { ensureActivitySpan } from '../timeline/activity';

let browserSessionRecycleTimer: NodeJS.Timeout | undefined;
const BROWSER_SESSION_RECYCLE_INTERVAL_MS = 90_000;
const BROWSER_SESSION_RECYCLE_DEFER_MS = 5_000;
const BROWSER_SESSION_RECYCLE_IDLE_GRACE_MS = 4_000;

function isServerVadPeriodicSessionRecycleEnabled(): boolean {
  const raw = String(
    configService.get('SERVER_VAD_PERIODIC_SESSION_RECYCLE_ENABLED')
    || ''
  ).trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function stopBrowserSessionRecycleLoop() {
  if (browserSessionRecycleTimer) {
    clearTimeout(browserSessionRecycleTimer);
    browserSessionRecycleTimer = undefined;
  }
}

function scheduleBrowserSessionRecycleLoop(delayMs = BROWSER_SESSION_RECYCLE_INTERVAL_MS) {
  stopBrowserSessionRecycleLoop();
  if (!isServerVadPeriodicSessionRecycleEnabled()) return;

  browserSessionRecycleTimer = setTimeout(() => {
    browserSessionRecycleTimer = undefined;

    if (!isServerVadPeriodicSessionRecycleEnabled()) return;
    if (!(session.browserConn && isOpen(session.browserConn))) return;

    const turnType = (session as any).voiceTuning?.turnDetection?.type || getVoiceModePreset('normal').vad_type;
    if (turnType !== 'server_vad') {
      scheduleBrowserSessionRecycleLoop();
      return;
    }

    const now = Date.now();
    const lastInboundAudioAtMs = (session as any).lastInboundAudioAtMs as number | undefined;
    const inboundRecently = typeof lastInboundAudioAtMs === 'number'
      ? (now - lastInboundAudioAtMs) < BROWSER_SESSION_RECYCLE_IDLE_GRACE_MS
      : false;
    const responseInFlight = session.responseStartTimestamp !== undefined;
    const toolInFlight = !!session.waitingForTool;
    const modelOpen = isOpen(session.modelConn);

    if (inboundRecently || responseInFlight || toolInFlight || !modelOpen) {
      scheduleBrowserSessionRecycleLoop(BROWSER_SESSION_RECYCLE_DEFER_MS);
      return;
    }

    try {
      console.info('[voice][browser] Periodic realtime session recycle triggered');
      sendVoiceSessionRecycleCue();
      closeModel();
      establishBrowserRealtimeModelConnection({
        skipGreeting: true,
        reason: 'browser_periodic_recycle',
      });
    } catch (err) {
      console.warn('[voice][browser] Periodic realtime session recycle failed', err);
    }

    scheduleBrowserSessionRecycleLoop();
  }, Math.max(1000, delayMs));
}

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
    stopBrowserSessionRecycleLoop();
    try {
      ws.close();
    } catch {}
  });
  ws.on("close", (code: number, reason: Buffer) => {
    try {
      const r = reason?.toString?.() || '';
      console.warn('[ws][browser-call] websocket closed', { code, reason: r });
    } catch {}
    stopBrowserSessionRecycleLoop();
    // Mirror the in-band "close" event cleanup so that abrupt browser
    // disconnects (tab close, network drop) don't leave modelConn open
    // and block the next session from initializing.
    try {
      closeAllConnections();
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
      session.responseStartTimestamp = undefined;

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
        ensureActivitySpan((session as any).currentConversationId, 'voice', 'voice');
      } catch {}

      establishBrowserRealtimeModelConnection();
      scheduleBrowserSessionRecycleLoop();
      break;
    }
    case "media": {
      session.latestMediaTimestamp = msg.media?.timestamp;
      (session as any).lastInboundAudioAtMs = Date.now();
      if (isOpen(session.modelConn)) {
        jsonSend(session.modelConn, {
          type: "input_audio_buffer.append",
          audio: msg.media?.payload,
        });
        try {
          const cur = (session as any)._inboundAudioFramesSinceResponseStart || 0;
          (session as any)._inboundAudioFramesSinceResponseStart = cur + 1;
        } catch {}
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
          eagerness: persistedPreset.eagerness,
        };

        const vadType = settings.vad_type || current.type || defaults.type;

        const thresholdVal = toNumber(settings.threshold);
        const prefixVal = toNumber(settings.prefix_padding_ms);
        const silenceVal = toNumber(settings.silence_duration_ms);
        const eagernessVal = settings.eagerness as string | undefined;
        const validEagerness = eagernessVal && ['low', 'medium', 'high', 'auto'].includes(eagernessVal)
          ? eagernessVal : undefined;

        // semantic_vad only accepts { type, eagerness? }; server_vad accepts { type, threshold, prefix_padding_ms, silence_duration_ms }
        const nextTurnDetection: any = vadType === 'none'
          ? { type: 'none' }
          : vadType === 'semantic_vad'
            ? {
                type: 'semantic_vad',
                ...(validEagerness ? { eagerness: validEagerness }
                  : (current.eagerness || defaults.eagerness) ? { eagerness: current.eagerness ?? defaults.eagerness } : {}),
              }
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
      stopBrowserSessionRecycleLoop();
      closeAllConnections();
      break;
    }
  }
}

function establishBrowserRealtimeModelConnection(options?: { skipGreeting?: boolean; reason?: string }) {
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
      },
    }
  );

  session.modelConn.on("open", () => {
    try {
      console.info('[ws][openai-realtime] browser model websocket open', {
        reason: options?.reason || 'browser_call_start',
      });
    } catch {}
    const sessionConfig = buildRealtimeSessionConfig('voice', 'pcm16');
    jsonSend(session.modelConn, {
      type: "session.update",
      session: sessionConfig,
    });

    if (session.browserConn && !options?.skipGreeting) {
      jsonSend(session.modelConn, {
        type: "response.create",
        response: {
          instructions:
            "Greet briefly in English, in a style that aligns with your given personality, before awaiting input.",
        },
      });
    }
  });

  session.modelConn.on("message", (data: RawData) =>
    processRealtimeModelEvent(data, logsClients, chatClients)
  );
  session.modelConn.on("error", (err) => {
    try {
      const errInfo = classifyOpenAIError(err);
      if (errInfo.isQuotaOrRateLimit) {
        console.error(`🚫 OpenAI quota/rate-limit error on browser-call realtime (code=${errInfo.code}, type=${errInfo.errorType}): ${errInfo.message}`);
        // Notify connected chat clients so the UI shows the issue
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, {
            type: 'chat.error',
            error: errInfo.userMessage,
            code: errInfo.code || 'rate_limit',
            timestamp: Date.now(),
          });
        }
      } else {
        console.error('[ws][openai-realtime] websocket error (browser-call)', err);
      }
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
