import { RawData, WebSocket } from "ws";
import { getDefaultAgent } from "../agentConfigs";
import { getAgent, FunctionHandler } from "../agentConfigs";
import { runSingleToolCall } from "../tools/orchestrators/runToolCalls";
import { contextInstructions, Context, getTimeContext, type Channel } from "../agentConfigs/context";
import { session, parseMessage, jsonSend, isOpen, closeAllConnections, closeModel, type ConversationItem } from "./state";
import { HOLD_MUSIC_ULAW_BASE64, HOLD_MUSIC_DURATION_MS } from "../assets/holdMusic";
import { appendEvent, ThoughtFlowStepType, ensureSession, endSession } from "../observability/thoughtflow";
import { addConversationEvent } from "../db/sqlite";
import { chatClients, logsClients } from "../ws/clients";
import { getChatVoiceConfig } from "../voice/voiceConfig";


// Accumulator for assistant voice transcript text by item id (server logs only)
const assistantVoiceByItem = new Map<string, string>();

// Timer handle for hold music loop
let holdMusicTimer: NodeJS.Timeout | undefined;
let browserHoldMusicTimer: NodeJS.Timeout | undefined;
// Add slight gap between hold music loops to avoid a harsh beat
const HOLD_MUSIC_LOOP_INTERVAL_MS = HOLD_MUSIC_DURATION_MS + 250;

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
function calculateAudioDurationMs(base64Data: string, audioFormat: 'g711_ulaw' | 'pcm16'): number {
  const base64Len = base64Data.length;
  // Base64 encoding: 4 chars = 3 bytes. Padding ('=') is handled by Math.floor.
  const audioBytes = Math.floor((base64Len * 3) / 4);
  
  if (audioFormat === 'g711_ulaw') {
    // g711_ulaw @ 8kHz: 1 byte = 1 sample, 8000 samples/sec
    // Duration (ms) = (bytes / 8000) * 1000 = bytes / 8
    return audioBytes / 8;
  } else {
    // pcm16 @ 24kHz: 2 bytes = 1 sample, 24000 samples/sec
    // Duration (ms) = (bytes / 2 / 24000) * 1000 = bytes / 48
    return audioBytes / 48;
  }
}

// ===== Voice Activity Detection (VAD) and Barge-in Configuration =====
// Default values are now loaded from the persisted voice-defaults store so they
// can be edited at runtime via the Settings > Voice UI.
import { getVoiceModePreset } from '../voice/voiceDefaults';

// Buffer latency estimate: typical client-side buffering before audio playback
// Used to adjust truncation offset to match what the user actually heard
const BUFFER_LATENCY_MS: number = 100;

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
 * @param channel - The communication channel ('voice', 'text', 'sms', or 'email')
 * @param audioFormat - The audio format to use ('g711_ulaw' for Twilio, 'pcm16' for browser)
 * @returns A complete session configuration object ready to send to the Realtime API
 */
export function buildRealtimeSessionConfig(channel: Channel, audioFormat: 'g711_ulaw' | 'pcm16') {
  const baseFunctions = getAgent('base').tools as FunctionHandler[];
  const functionSchemas = baseFunctions.map((f: FunctionHandler) => f.schema);
  const baseInstructions = getDefaultAgent().instructions;
  const { currentTime, timeZone } = getTimeContext();
  const context: Context = {
    channel,
    currentTime,
    timeZone,
  };
  const agentInstructions = [contextInstructions(context), baseInstructions].join('\n');
  const { turnDetection: runtimeTurnDetection } = getVoiceTuningForCall();
  
  // semantic_vad only accepts { type, eagerness? }; server_vad accepts { type, threshold, prefix_padding_ms, silence_duration_ms }
  const vadType = (runtimeTurnDetection?.type || 'server_vad') as 'server_vad' | 'semantic_vad';
  const turnDetection = runtimeTurnDetection?.type === 'none'
    ? { type: 'none' as const }
    : vadType === 'semantic_vad'
      ? {
          type: 'semantic_vad' as const,
          ...(runtimeTurnDetection?.eagerness ? { eagerness: runtimeTurnDetection.eagerness } : {}),
        }
      : {
          type: 'server_vad' as const,
          threshold: runtimeTurnDetection?.threshold,
          prefix_padding_ms: runtimeTurnDetection?.prefix_padding_ms,
          silence_duration_ms: runtimeTurnDetection?.silence_duration_ms,
        };
  
  const voiceConfig = getChatVoiceConfig();
  
  return {
    modalities: ["text", "audio"] as const,
    turn_detection: turnDetection,
    voice: voiceConfig.voice,
    speed: voiceConfig.speed,
    input_audio_transcription: { model: "whisper-1" },
    input_audio_format: audioFormat,
    output_audio_format: audioFormat,
    tools: functionSchemas,
    instructions: agentInstructions,
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

function finalizeRun(status: 'error' | undefined = undefined) {
  // For voice calls, finalize the sticky conversation when the call ends
  try {
    ensureSession();
    const conversationId = (session as any).currentConversationId as string | undefined;
    if (conversationId) {
      const event: any = {
        type: 'conversation.completed',
        conversation_id: conversationId,
        ended_at: new Date().toISOString(),
      };
      if (status) event.status = status;
      appendEvent(event);
    }
  } catch {}
  // Clear in-flight turn and sticky conversation id at end of call
  session.currentRequest = undefined;
  try { (session as any).currentConversationId = undefined; } catch {}
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
    finalizeRun('error');
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
    try {
      endSession();
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
      session.lastAssistantItem = undefined;
      session.responseStartTimestamp = undefined;
      session.responseCumulativeAudioMs = undefined;
      // Establish a sticky conversation for the lifetime of the call
      try {
        ensureSession();
        // Reset dependency anchors at call start
        try { (session as any).lastAssistantStepId = undefined; } catch {}
        try { (session as any).lastUserStepId = undefined; } catch {}
        const existingConv = (session as any).currentConversationId as string | undefined;
        if (!existingConv) {
          const convId = `conv_call_${Date.now()}`;
          (session as any).currentConversationId = convId;
          appendEvent({ type: 'conversation.started', conversation_id: convId, channel: 'voice', started_at: new Date().toISOString() });
        }
      } catch {}
      establishRealtimeModelConnection();
      break;
    case "media":
      session.latestMediaTimestamp = msg.media.timestamp;
      if (isOpen(session.modelConn)) {
        jsonSend(session.modelConn, {
          type: "input_audio_buffer.append",
          audio: msg.media.payload,
        });
      } else {
        logDroppingAudioIfNeeded('twilio');
      }
      break;
    case "close":
      console.info("📞 Call closed");
      finalizeRun();
      closeAllConnections();
      try { endSession(); } catch {}
      break;
  }
}

// Ensure the OpenAI realtime model connection is established for voice calls
export function establishRealtimeModelConnection() {
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
    });
  } catch {}

  const voiceModel = getAgent('base').voiceModel || getAgent('base').model || "gpt-4o-realtime-preview-2024-12-17";
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
    const sessionConfig = buildRealtimeSessionConfig('voice', 'g711_ulaw');
    jsonSend(session.modelConn, {
      type: "session.update",
      session: sessionConfig,
    });

    // Send a friendly greeting when a Twilio caller connects
    if (session.twilioConn) {
      jsonSend(session.modelConn, {
        type: "response.create",
        response: {
          instructions: "Greet the caller briefly in a style that aligns with your given personality before awaiting input.",
        },
      });
    }
  });

  session.modelConn.on("message", (data: RawData) => processRealtimeModelEvent(data, logsClients, chatClients));
  session.modelConn.on("error", (err) => {
    try {
      console.error('[ws][openai-realtime] websocket error', err);
      (session as any).lastModelErrorAtMs = Date.now();
    } catch {}
    finalizeRun('error');
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

  try {
    switch (event.type) {
    case "conversation.item.input_audio_transcription.completed": {
      // Final user ASR transcript (voice) — log once to server console
      const transcript: string = (event.transcript || event.text || "").toString();
      if (transcript) {
        console.log("[VOICE][USER][FINAL]", transcript);
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
      // If there is assistant audio that the client may still be playing, truncate (barge-in).
      // We gate on lastAssistantItem (cleared in response.output_item.done) rather than
      // responseStartTimestamp (cleared earlier in response.audio.done) so that barge-in
      // still works while buffered audio is playing after generation finishes.
      if (session.lastAssistantItem) {
        handleTruncation();
      }
      break;
    }
    case "response.audio.delta":
      // Drop audio deltas for a cancelled/truncated response (race window after response.cancel)
      if (event.item_id && event.item_id === (session as any)._cancelledItemId) {
        break;
      }
      if (session.twilioConn && session.streamSid) {
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = Date.now();
          session.responseCumulativeAudioMs = 0;
          // New response started — clear any stale cancelled-item guard
          (session as any)._cancelledItemId = undefined;
        }
        if (event.item_id) session.lastAssistantItem = event.item_id;
        
        // Track cumulative audio duration for accurate truncation
        if (event.delta && session.responseCumulativeAudioMs !== undefined) {
          const durationMs = calculateAudioDurationMs(event.delta, 'g711_ulaw');
          session.responseCumulativeAudioMs += durationMs;
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
          session.responseCumulativeAudioMs = 0;
          (session as any)._cancelledItemId = undefined;
        }
        if (event.item_id) session.lastAssistantItem = event.item_id;
        
        // Track cumulative audio duration for browser (pcm16 @ 24kHz)
        if (event.delta && session.responseCumulativeAudioMs !== undefined) {
          const durationMs = calculateAudioDurationMs(event.delta, 'pcm16');
          session.responseCumulativeAudioMs += durationMs;
        }
        
        if (isOpen(session.browserConn)) {
          jsonSend(session.browserConn, {
            event: "media",
            media: { payload: event.delta },
          });
        }
      }
      break;
    case "response.audio.done":
      // Audio generation for this response is complete. Clear the response-active
      // tracking so that speech_started after this point doesn't try response.cancel.
      // (response.output_item.done arrives later and clears lastAssistantItem too.)
      session.responseStartTimestamp = undefined;
      break;
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

        // Response finished; clear truncation tracking so subsequent speech_started
        // does not truncate an already-completed assistant response.
        session.lastAssistantItem = undefined;
        session.responseStartTimestamp = undefined;
        session.responseCumulativeAudioMs = undefined;

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
    finalizeRun('error');
  }
}

async function handleFunctionCall(item: { name: string; arguments: string; call_id?: string }, logsClients: Set<WebSocket>) {
  console.log("Handling function call:", item);
  const isSupervisorEscalation = item.name === 'getNextResponseFromSupervisor';
  if (isSupervisorEscalation) {
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
    finalizeRun('error');
    return JSON.stringify({ error: `Error running function ${item.name}: ${err?.message || 'unknown'}` });
  } finally {
    if (isSupervisorEscalation) {
      session.waitingForTool = false;
      stopHoldMusicLoop();
    }
  }
}

function handleTruncation() {
  if (
    !session.lastAssistantItem ||
    session.responseCumulativeAudioMs === undefined
  )
    return;
  
  // Use cumulative audio duration sent to client, accounting for buffering latency
  // Research shows Twilio buffers ~60-100ms before playback to the caller
  // We subtract this offset to avoid truncating audio the user actually heard
  const rawAudioMs = session.responseCumulativeAudioMs;
  const audio_end_ms = Math.floor(Math.max(0, rawAudioMs - BUFFER_LATENCY_MS));
  
  // Log truncation for debugging (console.debug is safe and won't throw in Node.js)
  console.debug(`[TRUNCATE] Truncating assistant audio at ${audio_end_ms}ms (raw: ${rawAudioMs}ms, buffer: ${BUFFER_LATENCY_MS}ms)`);

  // Track the cancelled item so late-arriving audio deltas for it are dropped
  (session as any)._cancelledItemId = session.lastAssistantItem;
  
  if (isOpen(session.modelConn)) {
    // Cancel the in-flight response to stop OpenAI from generating more audio.
    jsonSend(session.modelConn, {
      type: "response.cancel",
    } as any);

    // Truncate the stored conversation item to the point the user actually heard
    jsonSend(session.modelConn, {
      type: "conversation.item.truncate",
      item_id: session.lastAssistantItem,
      content_index: 0,
      audio_end_ms,
    } as any);
  }
  if (session.twilioConn && session.streamSid) {
    jsonSend(session.twilioConn, {
      event: "clear",
      streamSid: session.streamSid,
    } as any);
  }
  if (session.browserConn) {
    jsonSend(session.browserConn, { event: "clear" } as any);
  }
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
  session.responseCumulativeAudioMs = undefined;
}
