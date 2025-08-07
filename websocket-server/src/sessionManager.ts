import { RawData, WebSocket } from "ws";
import OpenAI, { ClientOptions } from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ResponsesTextInput } from "./types";
import { getAllFunctions, getDefaultAgent, FunctionHandler } from "./agentConfigs";
import { isSmsWindowOpen, getNumbers } from './smsState';
import { sendSms } from './sms';

interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  chatConn?: WebSocket;
  modelConn?: WebSocket; // Raw WebSocket for voice
  textModelConn?: WebSocket; // OpenAI SDK WebSocket for text
  openaiClient?: OpenAI;
  streamSid?: string;
  saved_config?: any;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  openAIApiKey?: string;
  conversationHistory?: Array<{
    type: 'user' | 'assistant',
    content: string,
    timestamp: number,
    channel: 'voice' | 'text',
    supervisor?: boolean
  }>;
  previousResponseId?: string; // For Responses API conversation tracking
}

let session: Session = {};

export function handleCallConnection(ws: WebSocket, openAIApiKey: string) {
  console.info("📞 New call connection");
  session.openAIApiKey = openAIApiKey;
  session.twilioConn = ws;
  ws.on("message", (data) => handleTwilioMessage(data));
  ws.on("error", ws.close);
  // Cleanup handled in server.ts on close
}

export function handleFrontendConnection(ws: WebSocket, logsClients: Set<WebSocket>) {
  // On new frontend connection, replay existing conversation history
  if (session.conversationHistory) {
    for (const msg of session.conversationHistory) {
      jsonSend(ws, {
        type: "conversation.item.created",
        item: {
          id: `msg_${msg.timestamp}`,
          type: "message",
          role: msg.type,
          content: [{ type: "text", text: msg.content }],
          channel: msg.channel,
          supervisor: msg.supervisor,
        },
      });
    }
  }

  ws.on("message", (data) => handleFrontendMessage(data, logsClients));
  // No session cleanup here; handled by Set in server.ts
}

export function handleChatConnection(ws: WebSocket, openAIApiKey: string, chatClients: Set<WebSocket>, logsClients: Set<WebSocket>) {
  session.openAIApiKey = openAIApiKey;
  if (!session.conversationHistory) {
    session.conversationHistory = [];
  }
  // Optional: send existing assistant messages to new chat client
  for (const msg of session.conversationHistory) {
    if (msg.type === 'assistant') {
      jsonSend(ws, {
        type: "chat.response",
        content: msg.content,
        timestamp: msg.timestamp,
        supervisor: msg.supervisor,
      });
    }
  }
  ws.on("message", (data) => handleChatMessage(data, chatClients, logsClients));
  ws.on("error", ws.close);
  // No session cleanup here; handled by Set in server.ts
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
    const result = await func.handler(args as any);
    return result;
  } catch (err: any) {
    console.error("Error running function:", err);
    return JSON.stringify({
      error: `Error running function ${item.name}: ${err.message}`,
    });
  }
}

function handleTwilioMessage(data: RawData) {
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
      tryConnectModel();
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

function handleFrontendMessage(data: RawData, logsClients: Set<WebSocket>) {
  const msg = parseMessage(data);
  if (!msg) return;

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, msg);
  }

  if (msg.type === "session.update") {
    session.saved_config = msg.session;
  }
}

async function handleChatMessage(data: RawData, chatClients: Set<WebSocket>, logsClients: Set<WebSocket>) {
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

export async function handleTextChatMessage(content: string, chatClients: Set<WebSocket>, logsClients: Set<WebSocket>) {
  try {
    console.log("🔤 Processing text message:", content);
    
    // Initialize OpenAI client if needed
    if (!session.openaiClient) {
      if (!process.env.OPENAI_API_KEY) {
        console.error("❌ No OpenAI API key set in environment");
        return;
      }
      const options: ClientOptions = {
        apiKey: process.env.OPENAI_API_KEY,
      };
      if (process.env.CODEX_CLI === 'true' && process.env.HTTPS_PROXY) {
        options.httpAgent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
        console.debug('OpenAI Client', 'Using proxy agent for Codex environment');
      }
      session.openaiClient = new OpenAI(options);
      console.log("✅ OpenAI REST client initialized for text chat");
    }
    
    // Add user message to conversation history
    const userMessage = {
      type: 'user' as const,
      content: content,
      timestamp: Date.now(),
      channel: 'text' as const,
      supervisor: false
    };
    
    if (!session.conversationHistory) {
      session.conversationHistory = [];
    }
    session.conversationHistory.push(userMessage);
    
    // Forward user message to observability clients
    for (const ws of logsClients) {
      if (isOpen(ws)) jsonSend(ws, {
        type: "conversation.item.created",
        item: {
          id: `msg_${Date.now()}`,
          type: "message",
          role: "user",
          content: [{ type: "text", text: content }],
          channel: "text"
        }
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
    
    // Add previous response ID if available for conversation continuity
    if (session.previousResponseId) {
      requestBody.previous_response_id = session.previousResponseId;
    }
    
    // Format user input as a message in an array
    const userInput: ResponsesTextInput = {
      type: "message",
      content: content,
      role: "user"
    };
    
    // Input must be a string or array of input items, not an object
    requestBody.input = [userInput];
    
    // Add debug logs for request
    console.log("[DEBUG] Responses API Request:", JSON.stringify(requestBody, null, 2));
    
    // Call Responses API
    const response = await session.openaiClient.responses.create(requestBody);
    
    // Add debug logs for response
    console.log("[DEBUG] Responses API Response:", JSON.stringify({
      id: response.id,
      output_text: response.output_text,
      output: response.output
    }, null, 2));
    
    // Process function calls from output array
    const functionCalls = response.output?.filter(output => output.type === "function_call");
    
    // Handle function calls (supervisor agent escalation)
    if (functionCalls && functionCalls.length > 0) {
      const functionCall = functionCalls[0];
      console.log(`🔧 Function call detected: ${functionCall.name}`);
      
      // Send function call start event to frontend observability
      for (const ws of logsClients) {
        if (isOpen(ws)) jsonSend(ws, {
          type: "response.function_call_arguments.delta",
          name: functionCall.name,
          arguments: functionCall.arguments,
          call_id: functionCall.call_id
        });
      }

      // --- SMS placeholder for tool call ---
      if (isSmsWindowOpen()) {
        const { smsUserNumber, smsTwilioNumber } = getNumbers();
        sendSms('...', smsTwilioNumber, smsUserNumber).catch(e => console.error('sendSms error', e));
      }

      try {
        // Find and execute the function
        const allFunctions = getAllFunctions();
        const functionHandler = allFunctions.find((f: FunctionHandler) => f.schema.name === functionCall.name);
        if (functionHandler) {
          const args = JSON.parse(functionCall.arguments);
          console.log(`🧠 Executing ${functionCall.name} with args:`, args);
          
          // Create breadcrumb function for supervisor agent nested function calls
          const addBreadcrumb = (title: string, data?: any) => {
            for (const ws of logsClients) {
              if (isOpen(ws)) jsonSend(ws, {
                type: "response.function_call_arguments.delta",
                name: title.includes("function call:") ? title.split("function call: ")[1] : title,
                arguments: JSON.stringify(data || {}),
                call_id: `supervisor_${Date.now()}`
              });
            }
            // --- SMS placeholder for nested tool call ---
            if (isSmsWindowOpen()) {
              const { smsUserNumber, smsTwilioNumber } = getNumbers();
              sendSms('......', smsTwilioNumber, smsUserNumber).catch(e => console.error('sendSms error', e));
            }
          };
          
          const functionResult = await functionHandler.handler(args, addBreadcrumb);
          console.log(`✅ Function result received (${functionResult.length} chars)`);

          // Send function call completion event to frontend observability
          for (const ws of logsClients) {
            if (isOpen(ws)) jsonSend(ws, {
              type: "response.function_call_arguments.done",
              name: functionCall.name,
              arguments: functionCall.arguments,
              call_id: functionCall.call_id,
              status: "completed"
            });
          }

          // Follow-up request to complete tool call and have base agent respond
          const functionSchemas = allFunctions.map((f: FunctionHandler) => ({ ...f.schema, strict: true }));
          const followUpBody = {
            model: "gpt-4o",
            previous_response_id: response.id,
            instructions:
              "Using the supervisor's result, provide a concise plain-text answer in two or three sentences. If important details would be lost, use the sendCanvas tool to deliver the full response.",
            input: [
              {
                type: "function_call_output" as const,
                call_id: functionCall.call_id,
                output:
                  typeof functionResult === "string"
                    ? functionResult
                    : JSON.stringify(functionResult)
              }
            ],
            tools: functionSchemas,
            max_output_tokens: 500
          };

          console.log("[DEBUG] Follow-up Responses API request:", JSON.stringify(followUpBody, null, 2));
          const followUpResponse = await session.openaiClient.responses.create(followUpBody);
          console.log(
            "[DEBUG] Follow-up Responses API response:",
            JSON.stringify(
              {
                id: followUpResponse.id,
                output_text: followUpResponse.output_text,
                output: followUpResponse.output
              },
              null,
              2
            )
          );

          // Update conversation state with new response id
          session.previousResponseId = followUpResponse.id;

          const finalResponse =
            followUpResponse.output_text || "Supervisor agent completed.";

          // Add assistant response to conversation history
          const assistantMessage = {
            type: "assistant" as const,
            content: finalResponse,
            timestamp: Date.now(),
            channel: "text" as const,
            supervisor: true
          };
          session.conversationHistory.push(assistantMessage);

          // Send response back to chat clients
          for (const ws of chatClients) {
            if (isOpen(ws))
              jsonSend(ws, {
                type: "chat.response",
                content: finalResponse,
                timestamp: Date.now(),
                supervisor: true
              });
          }

          // Forward assistant response to observability clients
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
                  supervisor: true
                }
              });
          }
          // --- SMS reply window logic ---
          try {
            if (isSmsWindowOpen()) {
              const { smsUserNumber, smsTwilioNumber } = getNumbers();
              await sendSms(finalResponse, smsTwilioNumber, smsUserNumber);
            }
          } catch (e) {
            console.error('sendSms error', e);
          }
        } else {
          console.error(`❌ Function handler not found: ${functionCall.name}`);
        }
      } catch (error) {
        console.error("❌ Error executing function call:", error);
      }
    }
    // Handle regular text responses
    else if (response.output_text) {
      console.log("✅ Received text response from OpenAI:", response.output_text.substring(0, 100) + "...");
      
      // Add assistant response to conversation history
      const assistantMessage = {
        type: 'assistant' as const,
        content: response.output_text,
        timestamp: Date.now(),
        channel: 'text' as const,
        supervisor: false
      };
      session.conversationHistory.push(assistantMessage);
      
      // Send response back to chat client
      for (const ws of chatClients) {
        if (isOpen(ws)) jsonSend(ws, {
          type: "chat.response",
          content: response.output_text,
          timestamp: Date.now()
        });
      }
      
      // Forward assistant response to observability clients
      for (const ws of logsClients) {
        if (isOpen(ws)) jsonSend(ws, {
          type: "conversation.item.created",
          item: {
            id: `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: response.output_text }],
            channel: "text"
          }
        });
      }
      // Update conversation state with base agent response id
      session.previousResponseId = response.id;
      // --- SMS reply window logic ---
      try {
        const text = response?.output_text;
        if (text && isSmsWindowOpen()) {
          const { smsUserNumber, smsTwilioNumber } = getNumbers();
          await sendSms(text, smsTwilioNumber, smsUserNumber);
        }
      } catch (e) {
        console.error('sendSms error', e);
      }
    } else {
      console.error("❌ No response content from OpenAI");
    }
    
  } catch (error) {
    console.error("❌ Error in text chat handler:", error);
    
    // Send error response to chat client
    for (const ws of chatClients) {
      if (isOpen(ws)) jsonSend(ws, {
        type: "chat.error",
        error: "Failed to get response from AI",
        timestamp: Date.now()
      });
    }
  }
}

// Explicitly type globalThis for logsClients/chatClients to avoid TS7017
declare global {
  // eslint-disable-next-line no-var
  var logsClients: Set<WebSocket> | undefined;
  // eslint-disable-next-line no-var
  var chatClients: Set<WebSocket> | undefined;
}

function tryConnectModel() {
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

  session.modelConn.on("message", (data: RawData) => handleModelMessage(data, global.logsClients ?? new Set(), global.chatClients ?? new Set()));
  session.modelConn.on("error", closeModel);
  session.modelConn.on("close", closeModel);
}

function shouldForwardToFrontend(event: any): boolean {
  // Filter out events that would disrupt existing chat history
  if (event.type === "session.created") {
    console.log("🚫 Filtering session.created event to preserve chat history");
    return false;
  }
  
  // Filter out session.updated events that might reset frontend state
  if (event.type === "session.updated") {
    console.log("🚫 Filtering session.updated event to preserve chat history");
    return false;
  }
  
  // Allow all other events through
  return true;
}

function handleModelMessage(data: RawData, logsClients: Set<WebSocket> = new Set(), chatClients: Set<WebSocket> = new Set()) {
  const event = parseMessage(data);
  if (!event) return;

  // Filter events before forwarding to frontend to preserve chat history
  if (shouldForwardToFrontend(event)) {
    for (const ws of logsClients) {
      if (isOpen(ws)) jsonSend(ws, event);
    }
  }

  switch (event.type) {
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
        // Handle text responses from assistant
        const textContent = item.content?.find((c: any) => c.type === "text");
        if (textContent && session.chatConn) {
          // Add to conversation history
          if (!session.conversationHistory) {
            session.conversationHistory = [];
          }
          const assistantMessage: {type: 'user' | 'assistant', content: string, timestamp: number, channel: 'voice' | 'text', supervisor?: boolean} = {
            type: 'assistant' as const,
            content: textContent.text,
            timestamp: Date.now(),
            channel: 'text' as const,
            supervisor: false
          };
          session.conversationHistory.push(assistantMessage);
          
          // Send response back to chat client
          for (const ws of chatClients) {
            if (isOpen(ws)) jsonSend(ws, {
              type: "chat.response",
              content: textContent.text,
              timestamp: Date.now()
            });
          }
        }
      }
      break;
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
    });
    jsonSend(session.twilioConn, {
      event: "clear",
      streamSid: session.streamSid,
    });
  }

  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
}

function closeModel() {
  cleanupConnection(session.modelConn);
  session.modelConn = undefined;
  if (!session.twilioConn && !session.frontendConn) session = {};
}

function closeAllConnections() {
  if (session.twilioConn) {
    session.twilioConn.close();
    session.twilioConn = undefined;
  }
  if (session.modelConn) {
    session.modelConn.close();
    session.modelConn = undefined;
  }
  if (session.frontendConn) {
    session.frontendConn.close();
    session.frontendConn = undefined;
  }
  session.streamSid = undefined;
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
  session.latestMediaTimestamp = undefined;
  session.saved_config = undefined;
}

function cleanupConnection(ws?: WebSocket) {
  if (isOpen(ws)) ws.close();
}

function parseMessage(data: RawData): any {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (!isOpen(ws)) return;
  ws.send(JSON.stringify(obj));
}

function isOpen(ws?: WebSocket): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}
