import { RawData, WebSocket } from "ws";
import { getDefaultAgent } from "../agentConfigs";
import { getAgent, FunctionHandler } from "../agentConfigs";
import { runSingleToolCall } from "../tools/orchestrators/runToolCalls";
import { contextInstructions, Context, getTimeContext, type Channel } from "../agentConfigs/context";
import { getSchemasForAgent } from "../tools/registry";
import { session, parseMessage, jsonSend, isOpen, closeAllConnections, closeModel, type ConversationItem } from "./state";
import { HOLD_MUSIC_ULAW_BASE64, HOLD_MUSIC_DURATION_MS } from "../assets/holdMusic";
import { appendEvent, ThoughtFlowStepType, ensureSession } from "../observability/thoughtflow";
import { addConversationEvent } from "../db/sqlite";
import { chatClients, logsClients } from "../ws/clients";
import { getChatVoiceConfig } from "../voice/voiceConfig";
import { classifyOpenAIError } from "../services/openaiErrors";
import { memoryModule } from '../memory';
import type { ContextTurn } from '../memory';
import { getMemoryConfig } from '../memory/memoryConfig';
import { configService } from '../config';


// Accumulator for assistant voice transcript text by item id (server logs only)
const assistantVoiceByItem = new Map<string, string>();

// Timer handle for hold music loop
let holdMusicTimer: NodeJS.Timeout | undefined;
let browserHoldMusicTimer: NodeJS.Timeout | undefined;
let twilioSessionRecycleTimer: NodeJS.Timeout | undefined;
// Add slight gap between hold music loops to avoid a harsh beat
const HOLD_MUSIC_LOOP_INTERVAL_MS = HOLD_MUSIC_DURATION_MS + 250;
const TWILIO_SESSION_RECYCLE_INTERVAL_MS = 90_000;
const TWILIO_SESSION_RECYCLE_DEFER_MS = 5_000;
const TWILIO_SESSION_RECYCLE_IDLE_GRACE_MS = 4_000;

function isServerVadPeriodicSessionRecycleEnabled(): boolean {
  const raw = String(
    configService.get('SERVER_VAD_PERIODIC_SESSION_RECYCLE_ENABLED')
    || ''
  ).trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

export function sendVoiceSessionRecycleCue() {
  // Reuse the same hold/chime sound users already hear during tool waits.
  if (session.twilioConn && session.streamSid && isOpen(session.twilioConn)) {
    jsonSend(session.twilioConn, {
      event: 'media',
      streamSid: session.streamSid,
      media: { payload: HOLD_MUSIC_ULAW_BASE64 },
    } as any);
    jsonSend(session.twilioConn, {
      event: 'mark',
      streamSid: session.streamSid,
    } as any);
  }
  if (session.browserConn && isOpen(session.browserConn)) {
    jsonSend(session.browserConn, {
      event: 'hold.media',
      media: { payload: getHoldMusicPcm16Base64() },
    } as any);
  }
}

function logDroppingAudioIfNeeded(source: 'twilio' | 'browser') {
  const now = Date.now();
  const last = (session as any).lastDroppedAudioLogAtMs as number | undefined;
  if (typeof last === 'number' && now - last < 5000) return;
  (session as any).lastDroppedAudioLogAtMs = now;

  try {
    console.warn('[voice][audio] Dropping inbound audio because modelConn is not open', {
      source,
      streamSid: session.streamSid,
      modelReadyState: session.modelConn?.readyState,
      hasTwilioConn: !!session.twilioConn,
      hasBrowserConn: !!session.browserConn,
      latestMediaTimestamp: session.latestMediaTimestamp,
      lastModelClose: (session as any).lastModelClose,
    });
  } catch {}
}

const BROWSER_HOLD_SAMPLE_RATE_HZ = 24000;
const BROWSER_HOLD_DURATION_MS = 3000;
const BROWSER_HOLD_LOOP_INTERVAL_MS = BROWSER_HOLD_DURATION_MS + 250;
let holdMusicPcm16Base64: string | undefined;

function getHoldMusicPcm16Base64(): string {
  if (holdMusicPcm16Base64) return holdMusicPcm16Base64;
  const durationSeconds = BROWSER_HOLD_DURATION_MS / 1000;
  const samples = Math.max(1, Math.round(BROWSER_HOLD_SAMPLE_RATE_HZ * durationSeconds));
  const buf = Buffer.alloc(samples * 2);

  const chimeStarts = [0.0, 1.25];
  const partials = [
    { f: 660, a: 0.14 },
    { f: 990, a: 0.08 },
    { f: 1320, a: 0.05 },
  ];
  const attackS = 0.006;
  const decayS = 0.2;
  const chimeLenS = 1.5;

  for (let i = 0; i < samples; i++) {
    const t = i / BROWSER_HOLD_SAMPLE_RATE_HZ;

    let v = 0;
    for (const start of chimeStarts) {
      const dt = t - start;
      if (dt < 0 || dt > chimeLenS) continue;
      const attackEnv = 1 - Math.exp(-dt / Math.max(attackS, 1e-6));
      const decayEnv = Math.exp(-dt / Math.max(decayS, 1e-6));
      const env = attackEnv * decayEnv;

      for (const p of partials) {
        v += Math.sin(2 * Math.PI * p.f * t) * p.a * env;
      }
    }

    const clipped = Math.max(-1, Math.min(1, v));
    const int16 = (clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff) | 0;
    buf.writeInt16LE(int16, i * 2);
  }
  holdMusicPcm16Base64 = buf.toString('base64');
  return holdMusicPcm16Base64;
}

// Helper function to calculate audio duration from base64 payload
// (kept as a thin shim in case future code needs it; no current callers)

// ===== Voice Activity Detection (VAD) =====
// Default values are now loaded from the persisted voice-defaults store so they
// can be edited at runtime via the Settings > Voice UI.
//
// Barge-in/interruption is handled NATIVELY by the OpenAI Realtime API via
// server_vad with interrupt_response: true. We do NOT manually send
// response.cancel or conversation.item.truncate on speech_started. Our only
// barge-in responsibility is to flush downstream playback buffers (Twilio /
// browser) and drop any in-flight audio deltas for the cancelled response.
import { getVoiceModePreset } from '../voice/voiceDefaults';

function getVoiceTuningForCall() {
  const tuning = (session as any)?.voiceTuning;
  if (tuning?.turnDetection) {
    // Runtime override is active (set by agent tool or browser UI)
    return {
      turnDetection: tuning.turnDetection,
    };
  }
  // Fall back to persisted defaults for "normal" mode
  const preset = getVoiceModePreset('normal');
  return {
    turnDetection: {
      type: preset.vad_type,
      threshold: preset.threshold,
      prefix_padding_ms: preset.prefix_padding_ms,
      silence_duration_ms: preset.silence_duration_ms,
      eagerness: preset.eagerness,
    },
  };
}

/**
 * Determines the correct audio format based on the active session connections.
 * 
 * @returns 'g711_ulaw' for Twilio connections, 'pcm16' for browser connections
 */
export function getAudioFormatForSession(): 'g711_ulaw' | 'pcm16' {
  // Twilio uses g711_ulaw, browser uses pcm16
  return session.twilioConn ? 'g711_ulaw' : 'pcm16';
}

/**
 * Builds a complete session configuration for the OpenAI Realtime API.
 * 
 * This function ensures all required fields are included in session.update messages
 * to prevent the API from resetting fields to defaults, which can break voice processing.
 * 
 * @param channel - The communication channel ('voice', 'text', 'sms', 'email', or 'copilot')
 * @param audioFormat - The audio format to use ('g711_ulaw' for Twilio, 'pcm16' for browser)
 * @returns A complete session configuration object ready to send to the Realtime API
 */
export function buildRealtimeSessionConfig(channel: Channel, audioFormat: 'g711_ulaw' | 'pcm16') {
  // Strip 'strict' from tool schemas — valid for Responses API but rejected by Realtime API
  const functionSchemas = getSchemasForAgent('base').map((t: any) => {
    if (t.type === 'function') {
      const { strict, ...rest } = t;
      return rest;
    }
    return t;
  });
  const baseInstructions = getDefaultAgent().instructions;
  const { currentTime, timeZone } = getTimeContext();
  const context: Context = {
    channel,
    currentTime,
    timeZone,
  };
  const agentInstructions = [contextInstructions(context), baseInstructions].join('\n');
  const { turnDetection: runtimeTurnDetection } = getVoiceTuningForCall();
  
  // semantic_vad only accepts { type, eagerness?, interrupt_response?, create_response? };
  // server_vad accepts threshold/prefix_padding_ms/silence_duration_ms in addition.
  // We explicitly set interrupt_response: true so the model cancels its in-flight
  // response when user speech is detected — this is the native barge-in mechanism.
  const vadType = (runtimeTurnDetection?.type || 'server_vad') as 'server_vad' | 'semantic_vad';
  const turnDetection = runtimeTurnDetection?.type === 'none'
    ? { type: 'none' as const }
    : vadType === 'semantic_vad'
      ? {
          type: 'semantic_vad' as const,
          ...(runtimeTurnDetection?.eagerness ? { eagerness: runtimeTurnDetection.eagerness } : {}),
          create_response: true,
          interrupt_response: true,
        }
      : {
          type: 'server_vad' as const,
          threshold: runtimeTurnDetection?.threshold,
          prefix_padding_ms: runtimeTurnDetection?.prefix_padding_ms,
          silence_duration_ms: runtimeTurnDetection?.silence_duration_ms,
          create_response: true,
          interrupt_response: true,
        };
  
  const voiceConfig = getChatVoiceConfig();

  // GA API takes audio format as an object, not a string. µ-law (Twilio) is
  // 8 kHz and implicit; PCM is 24 kHz. Without this, OpenAI defaults to PCM
  // for both directions which silently breaks Twilio calls (the bytes are
  // interpreted as PCM and the model's PCM output won't play through µ-law
  // media streams).
  const formatObj = audioFormat === 'g711_ulaw'
    ? { type: 'audio/pcmu' as const }
    : { type: 'audio/pcm' as const, rate: 24000 as const };

  return {
    type: "realtime" as const,
    output_modalities: ["audio"] as const,
    instructions: agentInstructions,
    tools: functionSchemas,
    audio: {
      input: {
        format: formatObj,
        transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: turnDetection,
      },
      output: {
        format: formatObj,
        voice: voiceConfig.voice,
        speed: voiceConfig.speed,
      },
    },
  };
}

function stopHoldMusicLoop() {
  if (holdMusicTimer) {
    clearTimeout(holdMusicTimer);
    holdMusicTimer = undefined;
  }
  if (browserHoldMusicTimer) {
    clearTimeout(browserHoldMusicTimer);
    browserHoldMusicTimer = undefined;
  }
  if (session.twilioConn && session.streamSid) {
    // Ensure any queued hold music is cleared
    jsonSend(session.twilioConn, {
      event: "clear",
      streamSid: session.streamSid,
    });
  }
  if (session.browserConn) {
    jsonSend(session.browserConn, { event: 'hold.clear' } as any);
  }
}

function stopTwilioSessionRecycleLoop() {
  if (twilioSessionRecycleTimer) {
    clearTimeout(twilioSessionRecycleTimer);
    twilioSessionRecycleTimer = undefined;
  }
}

function scheduleTwilioSessionRecycleLoop(delayMs = TWILIO_SESSION_RECYCLE_INTERVAL_MS) {
  stopTwilioSessionRecycleLoop();
  if (!isServerVadPeriodicSessionRecycleEnabled()) return;

  twilioSessionRecycleTimer = setTimeout(() => {
    twilioSessionRecycleTimer = undefined;

    if (!isServerVadPeriodicSessionRecycleEnabled()) return;
    if (!(session.twilioConn && session.streamSid && isOpen(session.twilioConn))) return;

    // This mitigation targets server-side VAD calls where long sessions can
    // accumulate echo/queue artifacts over time. Keep semantic/none untouched.
    const turnDetection = getVoiceTuningForCall().turnDetection;
    if (turnDetection?.type && turnDetection.type !== 'server_vad') {
      scheduleTwilioSessionRecycleLoop();
      return;
    }

    const now = Date.now();
    const lastInboundAudioAtMs = (session as any).lastInboundAudioAtMs as number | undefined;
    const inboundRecently = typeof lastInboundAudioAtMs === 'number'
      ? (now - lastInboundAudioAtMs) < TWILIO_SESSION_RECYCLE_IDLE_GRACE_MS
      : false;
    const responseInFlight = session.responseStartTimestamp !== undefined;
    const toolInFlight = !!session.waitingForTool;
    const modelOpen = isOpen(session.modelConn);

    if (inboundRecently || responseInFlight || toolInFlight || !modelOpen) {
      scheduleTwilioSessionRecycleLoop(TWILIO_SESSION_RECYCLE_DEFER_MS);
      return;
    }

    try {
      console.info('[voice][twilio] Periodic realtime session recycle triggered');
      sendVoiceSessionRecycleCue();
      closeModel();
      establishRealtimeModelConnection({
        skipGreeting: true,
        reason: 'twilio_periodic_recycle',
      });
    } catch (err) {
      console.warn('[voice][twilio] Periodic realtime session recycle failed', err);
    }

    scheduleTwilioSessionRecycleLoop();
  }, Math.max(1000, delayMs));
}

function startHoldMusicLoop() {
  if (!(session.twilioConn && session.streamSid) && !session.browserConn) return;

  const sendTwilio = () => {
    if (!session.waitingForTool) return;
    if (!(session.twilioConn && session.streamSid)) return;

    jsonSend(session.twilioConn, {
      event: "media",
      streamSid: session.streamSid,
      media: { payload: HOLD_MUSIC_ULAW_BASE64 },
    });
    jsonSend(session.twilioConn, {
      event: "mark",
      streamSid: session.streamSid,
    });
    holdMusicTimer = setTimeout(sendTwilio, HOLD_MUSIC_LOOP_INTERVAL_MS);
  };

  const sendBrowser = () => {
    if (!session.waitingForTool) return;
    if (!(session.browserConn && isOpen(session.browserConn))) return;

    jsonSend(session.browserConn, {
      event: 'hold.media',
      media: { payload: getHoldMusicPcm16Base64() },
    } as any);
    browserHoldMusicTimer = setTimeout(sendBrowser, BROWSER_HOLD_LOOP_INTERVAL_MS);
  };

  if (session.twilioConn && session.streamSid) sendTwilio();
  if (session.browserConn) sendBrowser();
}

function finalizeRun() {
  // Clear only in-flight turn state so the session and conversation stay open.
  // The inactivity timer (SESSION_IDLE_TIMEOUT_MINUTES) is responsible for
  // finalizing the conversation/session when the user doesn't reconnect in time.
  // Preserving currentConversationId lets a reconnecting call resume the same thread.
  session.currentRequest = undefined;
  try { (session as any).lastAssistantStepId = undefined; } catch {}
  try { (session as any).lastUserStepId = undefined; } catch {}
}

export function establishCallSocket(ws: WebSocket, openAIApiKey: string) {
  console.info("📞 New call connection");
  session.openAIApiKey = openAIApiKey;
  session.twilioConn = ws;
  // Twilio realtime media/events from the voice call
  ws.on("message", (data) => processRealtimeCallEvent(data));
  ws.on("error", (err) => {
    try {
      console.error('[ws][twilio-call] websocket error', err);
    } catch {}
    finalizeRun();
    stopTwilioSessionRecycleLoop();
    try {
      ws.close();
    } catch {}
  });
  ws.on("close", (code: number, reason: Buffer) => {
    try {
      const r = reason?.toString?.() || '';
      console.warn('[ws][twilio-call] websocket closed', { code, reason: r, streamSid: session.streamSid });
    } catch {}
    finalizeRun();
    stopTwilioSessionRecycleLoop();
    // Twilio drops the WS directly on caller hangup without sending a
    // media-stream "close" event, so the cleanup in processRealtimeCallEvent's
    // "close" case never fires. Without this, modelConn survives across calls
    // and establishRealtimeModelConnection() early-returns, leaving the next
    // call silent. Mirror the media-stream close cleanup here for that case.
    try {
      closeAllConnections();
    } catch {}
  });
  // Cleanup handled in server.ts on close
}

// Handle realtime events from Twilio's media stream WebSocket
// (start, media, close, etc.) for active voice calls
export function processRealtimeCallEvent(data: RawData) {
  const msg = parseMessage(data);
  if (!msg) return;

  switch (msg.event) {
    case "start":
      console.info("📞 Call started");
      console.debug("📞 Call start event", msg);
      session.streamSid = msg.start.streamSid;
      session.latestMediaTimestamp = 0;
      session.responseStartTimestamp = undefined;
      // Establish a sticky conversation for the lifetime of the call
      try {
        ensureSession();
        // Reset dependency anchors at call start
        try { (session as any).lastAssistantStepId = undefined; } catch {}
        try { (session as any).lastUserStepId = undefined; } catch {}
        // If this is an agent-initiated outbound call, reuse the triggering conversation
        const outboundCtx = session.outboundCallContext;
        const existingConv = outboundCtx?.conversationId || (session as any).currentConversationId as string | undefined;
        if (!existingConv) {
          const convId = `conv_call_${Date.now()}`;
          (session as any).currentConversationId = convId;
          appendEvent({ type: 'conversation.started', conversation_id: convId, channel: 'voice', started_at: new Date().toISOString() });
        } else {
          (session as any).currentConversationId = existingConv;
        }
      } catch {}
      establishRealtimeModelConnection();
      scheduleTwilioSessionRecycleLoop();
      break;
    case "media":
      session.latestMediaTimestamp = msg.media.timestamp;
      (session as any).lastInboundAudioAtMs = Date.now();
      if (isOpen(session.modelConn)) {
        jsonSend(session.modelConn, {
          type: "input_audio_buffer.append",
          audio: msg.media.payload,
        });
        try {
          const cur = (session as any)._inboundAudioFramesSinceResponseStart || 0;
          (session as any)._inboundAudioFramesSinceResponseStart = cur + 1;
        } catch {}
      } else {
        logDroppingAudioIfNeeded('twilio');
      }
      break;
    case "close":
      console.info("📞 Call closed");
      finalizeRun();
      stopTwilioSessionRecycleLoop();
      closeAllConnections();
      break;
  }
}

// Ensure the OpenAI realtime model connection is established for voice calls
export function establishRealtimeModelConnection(options?: { skipGreeting?: boolean; reason?: string }) {
  // Connect to model if we have either a Twilio connection OR a chat connection
  const hasConnection = (session.twilioConn && session.streamSid) || session.chatConn;
  if (!hasConnection || !session.openAIApiKey)
    return;
  if (isOpen(session.modelConn)) return;

  try {
    console.info('[ws][openai-realtime] establishing model websocket', {
      hasTwilioConn: !!session.twilioConn,
      hasBrowserConn: !!session.browserConn,
      streamSid: session.streamSid,
      reason: options?.reason || 'call_start',
    });
  } catch {}

  const voiceModel = configService.get('REALTIME_MODEL') || getAgent('base').voiceModel || getAgent('base').model || "gpt-4o-realtime-preview-2024-12-17";
  session.modelConn = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${voiceModel}`,
    {
      headers: {
        Authorization: `Bearer ${session.openAIApiKey}`,
      },
    }
  );

  session.modelConn.on("open", () => {
    const sessionConfig = buildRealtimeSessionConfig('voice', 'g711_ulaw');

    // If this is an agent-initiated outbound call, inject recent conversation as context
    const outboundCtx = session.outboundCallContext;
    if (outboundCtx && outboundCtx.recentTurns.length > 0) {
      const turnsSummary = outboundCtx.recentTurns
        .map(t => `${t.role === 'user' ? 'User' : 'You'}: ${t.content}`)
        .join('\n');
      const contextPrefix = `[Conversation context — you initiated this call as a continuation of the following exchange. Pick up naturally where you left off.]\n${turnsSummary}\n\n`;
      sessionConfig.instructions = contextPrefix + sessionConfig.instructions;
    }

    console.info('[realtime] sending session.update with voice:', sessionConfig.audio?.output?.voice);
    jsonSend(session.modelConn, {
      type: "session.update",
      session: sessionConfig,
    });

    // Send greeting — contextual if outbound, generic if inbound
    if (session.twilioConn && !options?.skipGreeting) {
      const greetingInstruction = outboundCtx && outboundCtx.recentTurns.length > 0
        ? "You called the user as a follow-up to your prior conversation. Greet them briefly and continue naturally from where you left off."
        : "Greet the caller briefly in English, in a style that aligns with your given personality, before awaiting input.";
      jsonSend(session.modelConn, {
        type: "response.create",
        response: {
          instructions: greetingInstruction,
        },
      });
      // Clear outbound context after use
      if (outboundCtx) session.outboundCallContext = undefined;
    }
  });

  session.modelConn.on("message", (data: RawData) => processRealtimeModelEvent(data, logsClients, chatClients));
  session.modelConn.on("error", (err) => {
    try {
      const errInfo = classifyOpenAIError(err);
      if (errInfo.isQuotaOrRateLimit) {
        console.error(`🚫 OpenAI quota/rate-limit error on voice realtime (code=${errInfo.code}, type=${errInfo.errorType}): ${errInfo.message}`);
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, {
            type: 'chat.error',
            error: errInfo.userMessage,
            code: errInfo.code || 'rate_limit',
            timestamp: Date.now(),
          });
        }
      } else {
        console.error('[ws][openai-realtime] websocket error', err);
      }
      (session as any).lastModelErrorAtMs = Date.now();
    } catch {}
    finalizeRun();
    closeModel();
  });
  session.modelConn.on("close", (code: number, reason: Buffer) => {
    try {
      const r = reason?.toString?.() || '';
      (session as any).lastModelClose = { code, reason: r, atMs: Date.now() };
      console.warn('[ws][openai-realtime] websocket closed', {
        code,
        reason: r,
        streamSid: session.streamSid,
        latestMediaTimestamp: session.latestMediaTimestamp,
      });
    } catch {}
    finalizeRun();
    closeModel();
  });
}

function shouldForwardToFrontend(event: any): boolean {
  // Suppress harmless "no active response" cancel errors — these occur in the
  // race window between audio finishing and speech_started firing.
  if (event?.type === 'error' && event?.error?.code === 'response_cancel_not_active') {
    return false;
  }
  // Suppress shadow turn items (memory correction prompts) from the UI.
  // These are injected conversation items with IDs starting with 'shadow_mem_'.
  if (event?.type === 'conversation.item.created' && event?.item?.id?.startsWith('shadow_mem_')) {
    return false;
  }
  return true;
}

export function processRealtimeModelEvent(
  data: RawData,
  logsClients: Set<WebSocket> = new Set(),
  chatClients: Set<WebSocket> = new Set()
) {
  const event = parseMessage(data);
  if (!event) return;

  // Filter events before forwarding to frontend to preserve chat history
  if (shouldForwardToFrontend(event)) {
    for (const ws of logsClients) {
      if (isOpen(ws)) jsonSend(ws, event);
    }
  }

  /**
   * Voice shadow turn: when memories arrive late (after the model already started
   * or finished responding), cancel the active response, update session instructions,
   * inject a hidden system message telling the model to self-correct, then trigger
   * a new response. Mirrors the text-chat shadow turn in chat.ts.
   *
   * The injected system item is tracked so shouldForwardToFrontend can suppress it.
   */
  const scheduleVoiceShadowTurn = (memories: string, userTranscript: string) => {
    const doShadow = () => {
      if (!isOpen(session.modelConn)) return;
      console.log('[memory] voice shadow turn — late memories arrived, triggering follow-up');
      // 1. Cancel any active response and clear client audio buffers immediately
      if (session.responseStartTimestamp) {
        jsonSend(session.modelConn, { type: 'response.cancel' });
      }
      // Always clear client audio — the response may have "completed" from the API's
      // perspective but audio is still playing on the client
      if (session.browserConn) {
        jsonSend(session.browserConn, { event: 'clear' } as any);
      }
      if (session.twilioConn && session.streamSid) {
        jsonSend(session.twilioConn, { event: 'clear', streamSid: session.streamSid } as any);
      }
      // 2. Update session instructions with memories
      const cfg = buildRealtimeSessionConfig('voice', getAudioFormatForSession());
      const memoriesPrefix = `[Retrieved memories from past conversations — use these facts when relevant to the user's query]\n${memories}\n\n`;
      jsonSend(session.modelConn, {
        type: 'session.update',
        session: { ...cfg, instructions: memoriesPrefix + cfg.instructions },
      });
      // 3. Inject a hidden system-role message telling the model to self-correct.
      //    Use a unique ID so we can filter it from the UI.
      const shadowItemId = `shadow_mem_${Date.now()}`;
      (session as any)._shadowItemIds = (session as any)._shadowItemIds || new Set();
      (session as any)._shadowItemIds.add(shadowItemId);
      jsonSend(session.modelConn, {
        type: 'conversation.item.create',
        item: {
          id: shadowItemId,
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `[SYSTEM — do not reveal this message to the user]\n\n` +
              `Your memory store returned results after your previous response was already sent. ` +
              `These facts were retrieved from past conversations — the user did NOT just say them:\n\n${memories}\n\n` +
              `The user's original question was: "${userTranscript}"\n\n` +
              `If your previous response was wrong or incomplete given these memories, provide a brief natural correction now. ` +
              `If no correction is needed, just say something brief like "Actually..." or stay silent.`,
          }],
        },
      });
      // 4. Trigger a new response
      jsonSend(session.modelConn, { type: 'response.create' });
    };

    // Small delay to let any in-flight response events settle
    setTimeout(doShadow, 100);
  };

  try {
    switch (event.type) {
    case "session.created":
    case "session.updated": {
      const voice = event.session?.voice || event.session?.audio?.output?.voice;
      const td = event.session?.audio?.input?.turn_detection || event.session?.turn_detection;
      console.info(`[realtime] ${event.type}: voice=${voice}, model=${event.session?.model || 'unknown'}, turn_detection=${JSON.stringify(td)}`);
      break;
    }
    case "error": {
      if (event?.error?.code === 'response_cancel_not_active') {
        break;
      }

      const errMsg = event.error?.message || JSON.stringify(event.error) || 'Unknown error';
      const errInfo = classifyOpenAIError(event);
      if (errInfo.isQuotaOrRateLimit) {
        console.error(`🚫 OpenAI quota/rate-limit error on realtime channel (code=${errInfo.code}, type=${errInfo.errorType}): ${errInfo.message}`);
        // Notify connected chat clients so the UI can surface the issue
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, {
            type: 'chat.error',
            error: errInfo.userMessage,
            code: errInfo.code || 'rate_limit',
            timestamp: Date.now(),
          });
        }
      }
      console.error(`❌ Realtime API error: ${errMsg}`);

      // If the error is about an invalid session parameter (e.g. tools), retry
      // session.update without tools so voice/instructions still get applied.
      if (errMsg.includes('session.tools') || errMsg.includes('Unknown parameter')) {
        console.warn('⚠️ Retrying session.update without tools to preserve voice config');
        if (isOpen(session.modelConn)) {
          const audioFormat = getAudioFormatForSession();
          const { tools, ...configWithoutTools } = buildRealtimeSessionConfig('voice', audioFormat);
          jsonSend(session.modelConn, {
            type: 'session.update',
            session: configWithoutTools,
          });
        }
      }
      break;
    }
    case "conversation.item.input_audio_transcription.completed": {
      // Final user ASR transcript (voice) — log once to server console
      const transcript: string = (event.transcript || event.text || "").toString();
      if (transcript) {
        console.log("[VOICE][USER][FINAL]", transcript);
        // Inject memories if not already injected at speech_started.
        // With server_vad, injection at speech_started (from cache) is preferred since
        // the model starts responding before this transcript event arrives.
        const alreadyInjected = (session as any)._memoriesInjectedForTurn;
        (session as any)._memoriesInjectedForTurn = false;
        if (!alreadyInjected) {
          void ((): void => {
            // Build ContextTurn[] from voice conversation history
            const voiceHistoryTurns: ContextTurn[] = (session.conversationHistory || [])
              .filter((item): item is Extract<typeof item, { type: 'user' | 'assistant' }> =>
                item.type === 'user' || item.type === 'assistant'
              )
              .map(item => ({ role: item.type as 'user' | 'assistant', text: item.content }));
            // Use retrieveWithLate so late memories trigger a shadow turn via callback.
            memoryModule.retrieveWithLate(transcript, {
              timeoutMs: getMemoryConfig().retrieve_timeout_ms,
              conversationHistory: voiceHistoryTurns,
              onLateArrival: (lateResult) => {
                if (lateResult.newMemories) {
                  scheduleVoiceShadowTurn(lateResult.memories || lateResult.newMemories, transcript);
                }
              },
            }).then(({ memories, newMemories }) => {
              if (memories && isOpen(session.modelConn) && !session.responseStartTimestamp) {
                // Memories arrived in time — inject before response starts
                const cfg = buildRealtimeSessionConfig('voice', getAudioFormatForSession());
                const memoriesPrefix = `[Retrieved memories from past conversations — use these facts when relevant to the user's query]\n${memories}\n\n`;
                jsonSend(session.modelConn, {
                  type: 'session.update',
                  session: { ...cfg, instructions: memoriesPrefix + cfg.instructions },
                });
                console.debug('[memory] injected memories into voice session via session.update (at transcript)');
              } else if (memories && newMemories) {
                // Memories arrived but response already started — schedule a voice shadow turn
                scheduleVoiceShadowTurn(memories, transcript);
              }
            }).catch((e: any) => {
              console.warn('[memory] voice retrieval/injection error:', e?.message || e);
            });
          })();
        } else {
          console.debug('[memory] skipping transcript-time injection — already injected at speech_started');
        }
        const requestId = `req_${Date.now()}`;
        session.currentRequest = { id: requestId, channel: 'voice', startedAt: Date.now() } as any;
        ensureSession();
        // Reuse sticky conversation id for the entire call
        let conversationId = (session as any).currentConversationId as string | undefined;
        if (!conversationId) {
          conversationId = `conv_call_${Date.now()}`;
          (session as any).currentConversationId = conversationId;
          appendEvent({ type: 'conversation.started', conversation_id: conversationId, channel: 'voice', started_at: new Date().toISOString() });
        }
        const stepId = `step_user_${requestId}`;
        const userDepends = (session as any).lastAssistantStepId ? [(session as any).lastAssistantStepId] : undefined;
        appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: stepId, label: ThoughtFlowStepType.UserMessage, payload: { content: transcript }, ...(userDepends ? { depends_on: userDepends } : {}), timestamp: Date.now() });
        // Append user voice turn to unified conversation history
        try {
          if (!session.conversationHistory) session.conversationHistory = [];
          const ts = Date.now();
          session.conversationHistory.push({
            type: 'user',
            content: transcript,
            timestamp: ts,
            channel: 'voice',
            supervisor: false,
          });
          try {
            const conversationId2 = (session as any).currentConversationId as string | undefined;
            addConversationEvent({
              conversation_id: conversationId2 || '',
              kind: 'message_user',
              payload: { text: transcript, channel: 'voice', supervisor: false },
              created_at_ms: ts,
            });
          } catch {}
        } catch (e) {
          console.warn("⚠️ Failed to append user voice transcript to history", e);
        }
        appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: stepId, timestamp: Date.now() });
        try { (session as any).lastUserStepId = stepId; } catch {}
      }
      break;
    }
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta": {
      // Streaming assistant voice transcript text; accumulate by item_id for final logging
      const id = event.item_id;
      const delta: string = event.delta || "";
      if (id && delta) {
        assistantVoiceByItem.set(id, (assistantVoiceByItem.get(id) || "") + delta);
      }
      break;
    }
    case "response.output_text.done": {
      // Assistant produced final text output (may be during a voice call)
      const txt: string = (event.text || "").toString();
      if (txt) {
        console.log("[VOICE][ASSISTANT][FINAL-TEXT]", txt);
      }
      break;
    }
    case "input_audio_buffer.speech_started": {
      // === Barge-in: flush downstream buffers and suppress in-flight assistant audio ===
      //
      // OpenAI's Realtime API (server_vad with interrupt_response: true) auto-cancels
      // its in-flight response and auto-truncates the conversation item server-side.
      // Our only job here is:
      //   1. Flush any audio sitting in the downstream playback buffer (Twilio outbound
      //      queue / browser audio queue). The model has no visibility into those.
      //   2. Drop any late-arriving audio deltas for the cancelled response (they may
      //      already be in flight from OpenAI by the time the cancel takes effect).
      //   3. Stop hold music if a tool call is in flight, so it doesn't refill the
      //      buffer we just cleared.
      //
      // We do NOT send response.cancel or conversation.item.truncate — the API does that.
      try {
        console.debug('[BARGE-IN] speech_started — flushing downstream buffers', {
          hasTwilioConn: !!session.twilioConn,
          hasBrowserConn: !!session.browserConn,
          streamSid: session.streamSid,
          waitingForTool: session.waitingForTool,
          inboundFramesSinceResp: (session as any)._inboundAudioFramesSinceResponseStart,
          responseInFlight: session.responseStartTimestamp !== undefined,
        });
      } catch {}

      // 1. Suppress any in-flight assistant audio deltas until the next response begins.
      //    Cleared on response.created (next response) and response.done (safety net).
      (session as any)._suppressAssistantAudio = true;

      // 2. If hold music is playing during a tool call, stop the loop and clear its buffers
      //    so it doesn't refill what we're about to clear. stopHoldMusicLoop sends the
      //    appropriate clear events for both Twilio and browser (hold.clear).
      if (session.waitingForTool) {
        try { stopHoldMusicLoop(); } catch {}
      }

      // 3. Flush downstream playback buffers (assistant audio that's already been forwarded).
      if (session.twilioConn && session.streamSid && isOpen(session.twilioConn)) {
        jsonSend(session.twilioConn, { event: 'clear', streamSid: session.streamSid } as any);
      }
      if (session.browserConn && isOpen(session.browserConn)) {
        jsonSend(session.browserConn, { event: 'clear' } as any);
      }

      // 4. Clear in-flight response tracking — the API is cancelling its response,
      //    so any pending memory injection / shadow-turn decisions should treat the
      //    response as no-longer-active.
      session.responseStartTimestamp = undefined;

      // === Eagerly inject memories while the user is still speaking (cache-hit only) ===
      // With server_vad, the model starts responding as soon as it detects end-of-speech,
      // which is BEFORE the transcript event arrives on our server. Injecting here ensures
      // memories are in the session config before the next response starts.
      // NOTE: We intentionally do NOT set session.pendingMemoryPromise here because
      // retrieve('') with a cold cache resolves to null immediately (empty query guard),
      // and a truthy-but-null Promise would shadow the real transcript-based fetch later.
      try {
        memoryModule.retrieve('', getMemoryConfig().retrieve_timeout_ms).then(memories => {
          if (memories && isOpen(session.modelConn) && !session.responseStartTimestamp) {
            const sessionCfg = buildRealtimeSessionConfig('voice', getAudioFormatForSession());
            const memoriesPrefix = `[Retrieved memories from past conversations — use these facts when relevant to the user's query]\n${memories}\n\n`;
            jsonSend(session.modelConn, {
              type: 'session.update',
              session: { ...sessionCfg, instructions: memoriesPrefix + sessionCfg.instructions },
            });
            (session as any)._memoriesInjectedForTurn = true;
            console.debug('[memory] injected memories into voice session via session.update (at speech_started)');
          }
        }).catch(() => {});
      } catch {}

      break;
    }
    case "response.created": {
      // New response has begun — assistant audio deltas for it are legitimate again.
      (session as any)._suppressAssistantAudio = false;
      (session as any)._inboundAudioFramesSinceResponseStart = 0;
      try {
        console.debug('[VAD-DIAG] response.created', {
          response_id: event.response?.id,
          waitingForTool: session.waitingForTool,
        });
      } catch {}
      break;
    }
    case "input_audio_buffer.speech_stopped": {
      try {
        console.debug('[VAD-DIAG] speech_stopped', {
          item_id: event.item_id,
          audio_end_ms: event.audio_end_ms,
        });
      } catch {}
      break;
    }
    case "input_audio_buffer.committed": {
      try {
        console.debug('[VAD-DIAG] input_audio_buffer.committed', {
          item_id: event.item_id,
          previous_item_id: event.previous_item_id,
        });
      } catch {}
      break;
    }
    case "response.output_audio.delta":
    case "response.audio.delta": {
      // Drop deltas for a response that was interrupted (server VAD cancelled it
      // but already-in-flight deltas can still arrive briefly afterwards).
      if ((session as any)._suppressAssistantAudio) {
        break;
      }
      if (session.twilioConn && session.streamSid) {
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = Date.now();
        }
        if (isOpen(session.twilioConn)) {
          jsonSend(session.twilioConn, {
            event: "media",
            streamSid: session.streamSid,
            media: { payload: event.delta },
          });
          jsonSend(session.twilioConn, {
            event: "mark",
            streamSid: session.streamSid,
          });
        }
      }
      if (session.browserConn) {
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = Date.now();
        }
        if (isOpen(session.browserConn)) {
          jsonSend(session.browserConn, {
            event: "media",
            media: { payload: event.delta },
          });
        }
      }
      break;
    }
    case "response.output_audio.done":
    case "response.audio.done":
      // Audio generation for this response is complete. Clear in-flight flag so
      // memory injection / shadow-turn logic treats the next turn correctly.
      session.responseStartTimestamp = undefined;
      break;
    case "response.done": {
      // Defense in depth: clear in-flight tracking and audio suppression on any
      // response termination (completed, cancelled, failed, incomplete).
      session.responseStartTimestamp = undefined;
      (session as any)._suppressAssistantAudio = false;
      try {
        console.debug('[VAD-DIAG] response.done', {
          response_id: event.response?.id,
          status: event.response?.status,
          inboundFramesSinceResp: (session as any)._inboundAudioFramesSinceResponseStart,
        });
      } catch {}
      break;
    }
    case "response.output_item.done": {
      console.log("[VOICE][ASSISTANT][FINAL-VOICE]", event);
      const { item } = event;
      try {
        if (item?.status && item.status !== 'completed') {
          console.warn('[VOICE][ASSISTANT] output item not completed', {
            status: item.status,
            itemType: item.type,
            itemId: item.id,
            streamSid: session.streamSid,
          });
        }
      } catch {}
      if (item.type === "function_call") {
        handleFunctionCall(item, logsClients)
          .then((output) => {
            if (session.modelConn) {
              jsonSend(session.modelConn, {
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: item.call_id,
                  output: JSON.stringify(output),
                },
              });
              jsonSend(session.modelConn, { type: "response.create" });
            }
          })
          .catch((err) => {
            console.error("Error handling function call:", err);
          });
      } else if (item.type === "message" && item.role === "assistant") {
        // If the response was interrupted (barge-in via server_vad), the API marks
        // the item with status 'incomplete'. Skip persisting interrupted speech to
        // conversation history / ThoughtFlow so memory/summary code doesn't treat
        // it as something the user actually heard in full.
        const itemCompleted = !item?.status || item.status === 'completed';
        if (!itemCompleted) {
          try {
            console.debug('[VOICE][ASSISTANT] skipping persistence of incomplete assistant item', {
              itemId: item.id,
              itemStatus: item.status,
            });
          } catch {}
          // Still clean up per-item transcript accumulator to avoid leaks.
          try { if (item?.id) assistantVoiceByItem.delete(item.id); } catch {}
          break;
        }

        // Handle text responses from assistant (and log voice-only assembled transcript)
        let assistantText: string | undefined;
        const textContent = item.content?.find((c: any) => c.type === "text");
        if (textContent) {
          assistantText = textContent.text;
          // Log final assistant text for observability
          try {
            if (typeof textContent.text === "string" && textContent.text.trim()) {
              console.log("[VOICE][ASSISTANT][FINAL-TEXT]", textContent.text);
            }
          } catch {}

          // Always add assistant message to shared history (voice channel)
          try {
            if (!session.conversationHistory) session.conversationHistory = [];
            const ts = Date.now();
            const assistantMessage: ConversationItem = {
              type: 'assistant',
              content: textContent.text,
              timestamp: ts,
              channel: 'voice',
              supervisor: false,
            };
            session.conversationHistory.push(assistantMessage);
            try {
              const convId = (session as any).currentConversationId as string | undefined;
              if (convId) {
                addConversationEvent({
                  conversation_id: convId,
                  kind: 'message_assistant',
                  payload: { text: textContent.text, channel: 'voice', supervisor: false },
                  created_at_ms: ts,
                });
              }
            } catch {}
          } catch (e) {
            console.warn("⚠️ Failed to append assistant voice message to history", e);
          }

          // Optionally broadcast to chat clients if connected
          for (const ws of chatClients) {
            if (isOpen(ws)) jsonSend(ws, {
              type: "chat.response",
              content: textContent.text,
              timestamp: Date.now(),
            });
          }
        } else {
          // If no text content, persist the assembled voice transcript when available
          const id = item.id;
          const assembled = id ? (assistantVoiceByItem.get(id) || "") : "";
          if (assembled.trim()) {
            assistantText = assembled;
            console.log("[VOICE][ASSISTANT][FINAL-VOICE]", assembled);
            try {
              if (!session.conversationHistory) session.conversationHistory = [];
              const ts = Date.now();
              const assistantMessage: ConversationItem = {
                type: 'assistant',
                content: assembled,
                timestamp: ts,
                channel: 'voice',
                supervisor: false,
              };
              session.conversationHistory.push(assistantMessage);
              try {
                const convId = (session as any).currentConversationId as string | undefined;
                if (convId) {
                  addConversationEvent({
                    conversation_id: convId,
                    kind: 'message_assistant',
                    payload: { text: assembled, channel: 'voice', supervisor: false },
                    created_at_ms: ts,
                  });
                }
              } catch {}
            } catch (e) {
              console.warn("⚠️ Failed to append assembled assistant voice transcript to history", e);
            }
            // Also log the raw response payload for debugging/inspection
            try {
              const raw = JSON.stringify({ event_type: event.type, item }, null, 2);
              const trimmed = raw.length > 2000 ? raw.slice(0, 2000) + "…" : raw;
              console.log("[VOICE][ASSISTANT][FINAL-VOICE][RAW]", trimmed);
            } catch {
              console.log("[VOICE][ASSISTANT][FINAL-VOICE][RAW] <unserializable>");
            }
            if (id) assistantVoiceByItem.delete(id);
          }
        }

        // Response item finished — clear in-flight tracking as a safety net.
        // (response.done also clears these; this is belt-and-suspenders.)
        session.responseStartTimestamp = undefined;

        const convId = (session as any).currentConversationId as string | undefined;
        if (convId && session.currentRequest) {
          const stepId = `step_assistant_${session.currentRequest.id}_${Date.now()}`;
          const depends = (session as any).lastUserStepId ? [(session as any).lastUserStepId] : undefined;
          appendEvent({ type: 'step.started', conversation_id: convId, step_id: stepId, label: ThoughtFlowStepType.AssistantMessage, payload: { text: assistantText }, ...(depends ? { depends_on: depends } : {}), timestamp: Date.now() });
          appendEvent({ type: 'step.completed', conversation_id: convId, step_id: stepId, timestamp: Date.now() });
          try { (session as any).lastAssistantStepId = stepId; } catch {}
          // Do NOT finalize the conversation per turn; keep conversation open until call ends
        }
      }
      break;
    }
    }
  } catch (err) {
    console.error('Error processing realtime model event:', err);
    finalizeRun();
  }
}

async function handleFunctionCall(item: { name: string; arguments: string; call_id?: string }, logsClients: Set<WebSocket>) {
  console.log("Handling function call:", item);
  // Some tools (e.g. web_search) wrap a longer-running remote call. Play hold music
  // so the caller hears a gentle "still here" pulse while we wait for the result.
  const isWebSearchCall = item.name === 'web_search';
  if (isWebSearchCall) {
    session.waitingForTool = true;
    startHoldMusicLoop();
  }
  const convId = (session as any).currentConversationId as string | undefined;
  const stepId = convId ? `step_tool_${item.call_id || Date.now()}` : undefined;
  if (convId && stepId) {
    appendEvent({ type: 'step.started', conversation_id: convId, step_id: stepId, label: ThoughtFlowStepType.ToolCall, payload: { name: item.name, arguments: item.arguments }, timestamp: Date.now() });
  }
  try {
    const result = await runSingleToolCall(
      { name: item.name, arguments: item.arguments, call_id: item.call_id },
      { mode: 'voice', logsClients, confirm: false }
    );
    if (convId && stepId) {
      appendEvent({ type: 'step.completed', conversation_id: convId, step_id: stepId, payload: { output: result }, timestamp: Date.now() });
    }
    return result;
  } catch (err: any) {
    console.error("Error running function:", err);
    if (convId && stepId) {
      appendEvent({ type: 'step.completed', conversation_id: convId, step_id: stepId, payload: { error: err?.message || String(err) }, timestamp: Date.now() });
    }
    finalizeRun();
    return JSON.stringify({ error: `Error running function ${item.name}: ${err?.message || 'unknown'}` });
  } finally {
    if (isWebSearchCall) {
      session.waitingForTool = false;
      stopHoldMusicLoop();
    }
  }
}

