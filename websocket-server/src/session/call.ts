import { RawData, WebSocket } from "ws";
import { getAllFunctions, getDefaultAgent, FunctionHandler } from "../agentConfigs";
import { session, parseMessage, jsonSend, isOpen, closeAllConnections, closeModel, type ConversationItem } from "./state";

// Explicitly type globalThis for logsClients/chatClients to avoid TS7017
declare global {
  // eslint-disable-next-line no-var
  var logsClients: Set<WebSocket> | undefined;
  // eslint-disable-next-line no-var
  var chatClients: Set<WebSocket> | undefined;
}

// Accumulator for assistant voice transcript text by item id (server logs only)
const assistantVoiceByItem = new Map<string, string>();

export function establishCallSocket(ws: WebSocket, openAIApiKey: string) {
  console.info("📞 New call connection");
  session.openAIApiKey = openAIApiKey;
  session.twilioConn = ws;
  // Twilio realtime media/events from the voice call
  ws.on("message", (data) => processRealtimeCallEvent(data));
  ws.on("error", ws.close);
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

  session.modelConn = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
    {
      headers: {
        Authorization: `Bearer ${session.openAIApiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  session.modelConn.on("open", () => {
    const config = session.saved_config || {};

    // Include supervisor agent function for voice channel
    const allFunctions = getAllFunctions();
    const functionSchemas = allFunctions.map((f: FunctionHandler) => f.schema);
    const agentInstructions = getDefaultAgent().instructions;
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
  session.modelConn.on("error", closeModel);
  session.modelConn.on("close", closeModel);
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

  switch (event.type) {
    case "conversation.item.input_audio_transcription.completed": {
      // Final user ASR transcript (voice) — log once to server console
      const transcript: string = (event.transcript || event.text || "").toString();
      if (transcript) {
        console.log("[VOICE][USER][FINAL]", transcript);
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
        handleFunctionCall(item)
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
        const textContent = item.content?.find((c: any) => c.type === "text");
        if (textContent) {
          // Log final assistant text for observability
          try {
            if (typeof textContent.text === "string" && textContent.text.trim()) {
              console.log("[VOICE][ASSISTANT][FINAL-TEXT]", textContent.text);
            }
          } catch {}
        }
        if (textContent && session.chatConn) {
          // Add to conversation history
          if (!session.conversationHistory) {
            session.conversationHistory = [];
          }
            const assistantMessage: ConversationItem = {
              type: 'assistant',
              content: textContent.text,
              timestamp: Date.now(),
              channel: 'text',
              supervisor: false,
            };
            session.conversationHistory.push(assistantMessage);
          for (const ws of chatClients) {
            if (isOpen(ws)) jsonSend(ws, {
              type: "chat.response",
              content: textContent.text,
              timestamp: Date.now(),
            });
          }
        } else if (!textContent) {
          // If no text content, log the assembled voice transcript for this item if available
          const id = item.id;
          const assembled = id ? (assistantVoiceByItem.get(id) || "") : "";
          if (assembled.trim()) {
            console.log("[VOICE][ASSISTANT][FINAL-VOICE]", assembled);
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
      }
      break;
    }
  }
}

async function handleFunctionCall(item: { name: string; arguments: string }) {
  console.log("Handling function call:", item);
  const allFunctions = getAllFunctions();
  const func = allFunctions.find((f: FunctionHandler) => f.schema.name === item.name);
  if (!func) {
    throw new Error(`No handler found for function: ${item.name}`);
  }
  let args: unknown;
  try {
    args = JSON.parse(item.arguments);
  } catch {
    return JSON.stringify({
      error: "Invalid JSON arguments for function call.",
    });
  }
  try {
    console.log("Calling function:", func.schema.name, args);
    const result = await (func as any).handler(args as any);
    return result;
  } catch (err: any) {
    console.error("Error running function:", err);
    return JSON.stringify({
      error: `Error running function ${item.name}: ${err.message}`,
    });
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
