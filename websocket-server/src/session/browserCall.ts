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
import { processRealtimeModelEvent } from "./call";

export function establishBrowserCallSocket(ws: WebSocket, openAIApiKey: string) {
  console.info("\ud83c\udf10 New browser voice connection");
  session.openAIApiKey = openAIApiKey;
  session.browserConn = ws;

  ws.on("message", (data) => processBrowserCallEvent(data));
  ws.on("error", () => {
    ws.close();
  });
  ws.on("close", () => {
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
    const baseFunctions = getAgent("base").tools as FunctionHandler[];
    const functionSchemas = baseFunctions.map((f: FunctionHandler) => f.schema);
    const baseInstructions = getDefaultAgent().instructions;
    const { currentTime, timeZone } = getTimeContext();
    const context: Context = {
      channel: "voice",
      currentTime,
      timeZone,
    };
    const agentInstructions = [contextInstructions(context), baseInstructions].join("\n");

    const runtimeTurnDetection = (session as any)?.voiceTuning?.turnDetection;
    const turnDetection =
      runtimeTurnDetection?.type === 'none'
        ? { type: 'none' }
        : (runtimeTurnDetection || { type: "server_vad" });

    jsonSend(session.modelConn, {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        turn_detection: turnDetection,
        voice: "ballad",
        speed: 1.3,
        input_audio_transcription: { model: "whisper-1" },
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        tools: functionSchemas,
        instructions: agentInstructions,
      },
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
  session.modelConn.on("error", () => {
    closeModel();
  });
  session.modelConn.on("close", () => {
    closeModel();
  });
}
