import { RawData, WebSocket } from "ws";
import { getDefaultAgent } from "../agentConfigs";
import { getAgent, FunctionHandler } from "../agentConfigs";
import { executeFunctionCall } from "../tools/orchestrators/functionCallExecutor";
import { contextInstructions, Context } from "../agentConfigs/context";
import { session, parseMessage, jsonSend, isOpen, closeAllConnections, closeModel, type ConversationItem } from "./state";
import { HOLD_MUSIC_ULAW_BASE64, HOLD_MUSIC_DURATION_MS } from "../assets/holdMusic";
import { appendEvent, ThoughtFlowStepType, ensureSession } from "../observability/thoughtflow";

// Explicitly type globalThis for logsClients/chatClients to avoid TS7017
declare global {
  // eslint-disable-next-line no-var
  var logsClients: Set<WebSocket> | undefined;
  // eslint-disable-next-line no-var
  var chatClients: Set<WebSocket> | undefined;
}

// Accumulator for assistant voice transcript text by item id (server logs only)
const assistantVoiceByItem = new Map<string, string>();

// Timer handle for hold music loop
let holdMusicTimer: NodeJS.Timeout | undefined;
// Add slight gap between hold music loops to avoid a harsh beat
const HOLD_MUSIC_LOOP_INTERVAL_MS = HOLD_MUSIC_DURATION_MS + 250;

function stopHoldMusicLoop() {
  if (holdMusicTimer) {
    clearTimeout(holdMusicTimer);
    holdMusicTimer = undefined;
  }
  if (session.twilioConn && session.streamSid) {
    // Ensure any queued hold music is cleared
    jsonSend(session.twilioConn, {
      event: "clear",
      streamSid: session.streamSid,
    });
  }
}

function startHoldMusicLoop() {
  if (!session.twilioConn || !session.streamSid) return;

  const send = () => {
    if (!session.waitingForTool || !session.twilioConn || !session.streamSid) return;
    jsonSend(session.twilioConn, {
      event: "media",
      streamSid: session.streamSid,
      media: { payload: HOLD_MUSIC_ULAW_BASE64 },
    });
    jsonSend(session.twilioConn, {
      event: "mark",
      streamSid: session.streamSid,
    });
    holdMusicTimer = setTimeout(send, HOLD_MUSIC_LOOP_INTERVAL_MS);
  };

  send();
}

function finalizeRun(status: 'error' | undefined = undefined) {
  const req = session.currentRequest;
  if (!req) return;
  try {
    ensureSession();
    const runId = `run_${req.id}`;
    const event: any = {
      type: 'run.completed',
      run_id: runId,
      request_id: req.id,
      ended_at: new Date().toISOString(),
    };
    if (status) event.status = status;
    appendEvent(event);
  } catch {}
  session.currentRequest = undefined;
}

export function establishCallSocket(ws: WebSocket, openAIApiKey: string) {
  console.info("📞 New call connection");
  session.openAIApiKey = openAIApiKey;
  session.twilioConn = ws;
  // Twilio realtime media/events from the voice call
  ws.on("message", (data) => processRealtimeCallEvent(data));
  ws.on("error", () => { finalizeRun('error'); ws.close(); });
  ws.on("close", () => finalizeRun());
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
      establishRealtimeModelConnection();
      break;
    case "media":
      session.latestMediaTimestamp = msg.media.timestamp;
      if (isOpen(session.modelConn)) {
        jsonSend(session.modelConn, {
          type: "input_audio_buffer.append",
          audio: msg.media.payload,
        });
      }
      break;
    case "close":
      console.info("📞 Call closed");
      finalizeRun();
      closeAllConnections();
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
    const config = session.saved_config || {};

    // Voice channel: expose base agent tools only (supervisor/MCP excluded)
    const baseFunctions = getAgent('base').tools as FunctionHandler[];
    const functionSchemas = baseFunctions.map((f: FunctionHandler) => f.schema);
    const baseInstructions = getDefaultAgent().instructions;
    const context: Context = {
      channel: 'voice',
      currentTime: new Date().toLocaleString(),
    };
    const agentInstructions = [contextInstructions(context), baseInstructions].join('\n');
    jsonSend(session.modelConn, {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        turn_detection: { type: "server_vad" },
        voice: "ballad",
        speed: 1.3,
        input_audio_transcription: { model: "whisper-1" },
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        tools: functionSchemas,
        instructions: agentInstructions,
        ...config,
      },
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

  session.modelConn.on("message", (data: RawData) => processRealtimeModelEvent(data, global.logsClients ?? new Set(), global.chatClients ?? new Set()));
  session.modelConn.on("error", () => { finalizeRun('error'); closeModel(); });
  session.modelConn.on("close", () => { finalizeRun(); closeModel(); });
}

function shouldForwardToFrontend(event: any): boolean {
  // Forward ALL realtime events to the observability stream (`/logs`).
  // This improves visibility into the model's behavior during calls.
  // If you need to hide specific events in the future, add filtering here.
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
        const runId = `run_${requestId}`;
        appendEvent({ type: 'run.started', run_id: runId, request_id: requestId, channel: 'voice', started_at: new Date().toISOString() });
        const stepId = `step_user_${requestId}`;
        appendEvent({ type: 'step.started', run_id: runId, step_id: stepId, label: ThoughtFlowStepType.UserMessage, payload: { content: transcript }, timestamp: Date.now() });
        // Append user voice turn to unified conversation history
        try {
          if (!session.conversationHistory) session.conversationHistory = [];
          session.conversationHistory.push({
            type: 'user',
            content: transcript,
            timestamp: Date.now(),
            channel: 'voice',
            supervisor: false,
          });
        } catch (e) {
          console.warn("⚠️ Failed to append user voice transcript to history", e);
        }
        appendEvent({ type: 'step.completed', run_id: runId, step_id: stepId, timestamp: Date.now() });
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
    case "input_audio_buffer.speech_started":
      handleTruncation();
      break;
    case "response.audio.delta":
      if (session.twilioConn && session.streamSid) {
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = session.latestMediaTimestamp || 0;
        }
        if (event.item_id) session.lastAssistantItem = event.item_id;
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
      break;
    case "response.output_item.done": {
      console.log("[VOICE][ASSISTANT][FINAL-VOICE]", event);
      const { item } = event;
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
            const assistantMessage: ConversationItem = {
              type: 'assistant',
              content: textContent.text,
              timestamp: Date.now(),
              channel: 'voice',
              supervisor: false,
            };
            session.conversationHistory.push(assistantMessage);
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
              const assistantMessage: ConversationItem = {
                type: 'assistant',
                content: assembled,
                timestamp: Date.now(),
                channel: 'voice',
                supervisor: false,
              };
              session.conversationHistory.push(assistantMessage);
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

        const req = session.currentRequest;
        if (req) {
          const runId = `run_${req.id}`;
          const stepId = `step_assistant_${req.id}_${Date.now()}`;
          appendEvent({ type: 'step.started', run_id: runId, step_id: stepId, label: ThoughtFlowStepType.AssistantMessage, payload: { text: assistantText }, timestamp: Date.now() });
          appendEvent({ type: 'step.completed', run_id: runId, step_id: stepId, timestamp: Date.now() });
          finalizeRun();
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
  const req = session.currentRequest;
  const runId = req ? `run_${req.id}` : undefined;
  const stepId = runId ? `step_tool_${item.call_id || Date.now()}` : undefined;
  if (runId && stepId) {
    appendEvent({ type: 'step.started', run_id: runId, step_id: stepId, label: ThoughtFlowStepType.ToolCall, payload: { name: item.name, arguments: item.arguments }, timestamp: Date.now() });
  }
  try {
    const result = await executeFunctionCall(
      { name: item.name, arguments: item.arguments, call_id: item.call_id },
      { mode: 'voice', logsClients, confirm: false }
    );
    if (runId && stepId) {
      appendEvent({ type: 'step.completed', run_id: runId, step_id: stepId, payload: { output: result }, timestamp: Date.now() });
    }
    return result;
  } catch (err: any) {
    console.error("Error running function:", err);
    if (runId && stepId) {
      appendEvent({ type: 'step.completed', run_id: runId, step_id: stepId, payload: { error: err?.message || String(err) }, timestamp: Date.now() });
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
    session.responseStartTimestamp === undefined
  )
    return;
  const elapsedMs =
    (session.latestMediaTimestamp || 0) - (session.responseStartTimestamp || 0);
  const audio_end_ms = elapsedMs > 0 ? elapsedMs : 0;
  if (session.twilioConn && session.streamSid) {
    jsonSend(session.twilioConn, {
      type: "conversation.item.truncate",
      item_id: session.lastAssistantItem,
      content_index: 0,
      audio_end_ms,
    } as any);
    jsonSend(session.twilioConn, {
      event: "clear",
      streamSid: session.streamSid,
    } as any);
  }
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
}
