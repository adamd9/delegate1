import { RawData, WebSocket } from "ws";
import OpenAI, { ClientOptions } from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ResponsesTextInput } from "../types";
import { getAllFunctions, getDefaultAgent, FunctionHandler } from "../agentConfigs";
import { isSmsWindowOpen, getNumbers } from "../smsState";
import { sendSms } from "../sms";
import { session, parseMessage, jsonSend, isOpen } from "./state";

export function establishChatSocket(
  ws: WebSocket,
  openAIApiKey: string,
  chatClients: Set<WebSocket>,
  logsClients: Set<WebSocket>
) {
  session.openAIApiKey = openAIApiKey;
  if (!session.conversationHistory) {
    session.conversationHistory = [];
  }
  // Optional: send existing assistant messages to new chat client
  for (const msg of session.conversationHistory) {
    if (msg.type === "assistant") {
      jsonSend(ws, {
        type: "chat.response",
        content: msg.content,
        timestamp: msg.timestamp,
        supervisor: msg.supervisor,
      });
    }
  }
  ws.on("message", (data) => processChatSocketMessage(data, chatClients, logsClients));
  ws.on("error", ws.close);
  // No session cleanup here; handled by Set in server.ts
}

export async function processChatSocketMessage(
  data: RawData,
  chatClients: Set<WebSocket>,
  logsClients: Set<WebSocket>
) {
  const msg = parseMessage(data);
  if (!msg) return;
  console.log("💬 Chat message received:", msg);
  switch (msg.type) {
    case "chat.message":
      await handleTextChatMessage(msg.content, chatClients, logsClients);
      break;
    case "session.update":
      session.saved_config = msg.session;
      console.log("📝 Chat session config updated:", msg.session);
      break;
    default:
      console.log("❓ Unknown chat message type:", msg.type);
  }
}

export async function handleTextChatMessage(
  content: string,
  chatClients: Set<WebSocket>,
  logsClients: Set<WebSocket>
) {
  try {
    console.log("🔤 Processing text message:", content);
    // Initialize OpenAI client if needed
    if (!session.openaiClient) {
      if (!process.env.OPENAI_API_KEY) {
        console.error("❌ No OpenAI API key set in environment");
        return;
      }
      const options: ClientOptions = { apiKey: process.env.OPENAI_API_KEY };
      if (process.env.CODEX_CLI === "true" && process.env.HTTPS_PROXY) {
        options.httpAgent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
        console.debug("OpenAI Client", "Using proxy agent for Codex environment");
      }
      session.openaiClient = new OpenAI(options);
      console.log("✅ OpenAI REST client initialized for text chat");
    }
    // Add user message to conversation history
    const userMessage = {
      type: "user" as const,
      content: content,
      timestamp: Date.now(),
      channel: "text" as const,
      supervisor: false,
    };
    if (!session.conversationHistory) {
      session.conversationHistory = [];
    }
    session.conversationHistory.push(userMessage);
    // Forward user message to observability clients
    for (const ws of logsClients) {
      if (isOpen(ws))
        jsonSend(ws, {
          type: "conversation.item.created",
          item: {
            id: `msg_${Date.now()}`,
            type: "message",
            role: "user",
            content: [{ type: "text", text: content }],
            channel: "text",
          },
        });
    }
    // Import function schemas for supervisor agent
    const allFunctions = getAllFunctions();
    const functionSchemas = allFunctions.map((f: FunctionHandler) => ({ ...f.schema, strict: true }));
    console.log("🤖 Calling OpenAI Responses API for text response...");
    // Define system instructions
    const instructions = getDefaultAgent().instructions;
    // Prepare request body for Responses API
    const requestBody: any = {
      model: "gpt-4o",
      instructions: instructions,
      tools: functionSchemas,
      max_output_tokens: 500,
      temperature: 0.7,
      store: true,
    };
    if (session.previousResponseId) {
      requestBody.previous_response_id = session.previousResponseId;
    }
    const userInput: ResponsesTextInput = {
      type: "message",
      content: content,
      role: "user",
    };
    requestBody.input = [userInput];
    console.log("[DEBUG] Responses API Request:", JSON.stringify(requestBody, null, 2));
    const response = await session.openaiClient.responses.create(requestBody);
    console.log(
      "[DEBUG] Responses API Response:",
      JSON.stringify(
        { id: response.id, output_text: response.output_text, output: response.output },
        null,
        2
      )
    );
    const functionCalls = response.output?.filter((output: any) => output.type === "function_call");
    if (functionCalls && functionCalls.length > 0) {
      const functionCall = functionCalls[0];
      console.log(`🔧 Function call detected: ${functionCall.name}`);
      for (const ws of logsClients) {
        if (isOpen(ws))
          jsonSend(ws, {
            type: "response.function_call_arguments.delta",
            name: functionCall.name,
            arguments: functionCall.arguments,
            call_id: functionCall.call_id,
          });
      }
      // --- SMS placeholder for tool call ---
      if (isSmsWindowOpen()) {
        const { smsUserNumber, smsTwilioNumber } = getNumbers();
        sendSms("...", smsTwilioNumber, smsUserNumber).catch((e) => console.error("sendSms error", e));
      }
      try {
        const allFns = getAllFunctions();
        const functionHandler = allFns.find((f: FunctionHandler) => f.schema.name === functionCall.name);
        if (functionHandler) {
          const args = JSON.parse(functionCall.arguments);
          console.log(`🧠 Executing ${functionCall.name} with args:`, args);
          const addBreadcrumb = (title: string, data?: any) => {
            for (const ws of logsClients) {
              if (isOpen(ws))
                jsonSend(ws, {
                  type: "response.function_call_arguments.delta",
                  name: title.includes("function call:") ? title.split("function call: ")[1] : title,
                  arguments: JSON.stringify(data || {}),
                  call_id: `supervisor_${Date.now()}`,
                });
            }
            if (isSmsWindowOpen()) {
              const { smsUserNumber, smsTwilioNumber } = getNumbers();
              sendSms("......", smsTwilioNumber, smsUserNumber).catch((e) => console.error("sendSms error", e));
            }
          };
          const functionResult = await (functionHandler as any).handler(args, addBreadcrumb);
          console.log(`✅ Function result received (${(functionResult || '').length ?? 0} chars)`);
          for (const ws of logsClients) {
            if (isOpen(ws))
              jsonSend(ws, {
                type: "response.function_call_arguments.done",
                name: functionCall.name,
                arguments: functionCall.arguments,
                call_id: functionCall.call_id,
                status: "completed",
              });
          }
          const fnSchemas = allFns.map((f: FunctionHandler) => ({ ...f.schema, strict: true }));
          const followUpBody = {
            model: "gpt-4o",
            previous_response_id: response.id,
            instructions:
              "Using the supervisor's result, provide a concise plain-text answer in two or three sentences. If important details would be lost, use the sendCanvas tool to deliver the full response.",
            input: [
              {
                type: "function_call_output" as const,
                call_id: functionCall.call_id,
                output: typeof functionResult === "string" ? functionResult : JSON.stringify(functionResult),
              },
            ],
            tools: fnSchemas,
            max_output_tokens: 500,
          };
          console.log("[DEBUG] Follow-up Responses API request:", JSON.stringify(followUpBody, null, 2));
          const followUpResponse = await session.openaiClient.responses.create(followUpBody);
          console.log(
            "[DEBUG] Follow-up Responses API response:",
            JSON.stringify(
              { id: followUpResponse.id, output_text: followUpResponse.output_text, output: followUpResponse.output },
              null,
              2
            )
          );
          session.previousResponseId = followUpResponse.id;
          const finalResponse = followUpResponse.output_text || "Supervisor agent completed.";
          const assistantMessage = {
            type: "assistant" as const,
            content: finalResponse,
            timestamp: Date.now(),
            channel: "text" as const,
            supervisor: true,
          };
          session.conversationHistory.push(assistantMessage);
          for (const ws of chatClients) {
            if (isOpen(ws))
              jsonSend(ws, {
                type: "chat.response",
                content: finalResponse,
                timestamp: Date.now(),
                supervisor: true,
              });
          }
          // Forward assistant response to observability clients (/logs)
          for (const ws of logsClients) {
            if (isOpen(ws))
              jsonSend(ws, {
                type: "conversation.item.created",
                item: {
                  id: `msg_${Date.now()}`,
                  type: "message",
                  role: "assistant",
                  content: [{ type: "text", text: finalResponse }],
                  channel: "text",
                  supervisor: true,
                },
              });
          }
          return;
        }
      } catch (err) {
        console.error("❌ Error executing function call:", err);
      }
    }
    // Fallback to assistant text output
    const assistantText = response.output_text || "(No text output)";
    const assistantMessage = {
      type: "assistant" as const,
      content: assistantText,
      timestamp: Date.now(),
      channel: "text" as const,
      supervisor: false,
    };
    session.conversationHistory.push(assistantMessage);
    for (const ws of chatClients) {
      if (isOpen(ws))
        jsonSend(ws, { type: "chat.response", content: assistantText, timestamp: Date.now() });
    }
    // Forward assistant response to observability clients (/logs)
    for (const ws of logsClients) {
      if (isOpen(ws))
        jsonSend(ws, {
          type: "conversation.item.created",
          item: {
            id: `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: assistantText }],
            channel: "text",
            supervisor: false,
          },
        });
    }
  } catch (err) {
    console.error("❌ Error handling text chat message:", err);
  }
}
