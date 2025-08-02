import { RawData, WebSocket } from "ws";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getAllFunctions, getDefaultAgent, FunctionHandler } from "./agentConfigs";

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
  conversationHistory?: Array<{type: 'user' | 'assistant', content: string, timestamp: number, channel: 'voice' | 'text'}>;
}

let session: Session = {};

export function handleCallConnection(ws: WebSocket, openAIApiKey: string) {
  cleanupConnection(session.twilioConn);
  session.twilioConn = ws;
  session.openAIApiKey = openAIApiKey;

  ws.on("message", handleTwilioMessage);
  ws.on("error", ws.close);
  ws.on("close", () => {
    cleanupConnection(session.modelConn);
    cleanupConnection(session.twilioConn);
    session.twilioConn = undefined;
    session.modelConn = undefined;
    session.streamSid = undefined;
    session.lastAssistantItem = undefined;
    session.responseStartTimestamp = undefined;
    session.latestMediaTimestamp = undefined;
    if (!session.frontendConn) session = {};
  });
}

export function handleFrontendConnection(ws: WebSocket) {
  cleanupConnection(session.frontendConn);
  session.frontendConn = ws;

  ws.on("message", handleFrontendMessage);
  ws.on("close", () => {
    cleanupConnection(session.frontendConn);
    session.frontendConn = undefined;
    if (!session.twilioConn && !session.modelConn && !session.chatConn) session = {};
  });
}

export function handleChatConnection(ws: WebSocket, openAIApiKey: string) {
  cleanupConnection(session.chatConn);
  session.chatConn = ws;
  session.openAIApiKey = openAIApiKey;
  
  // Initialize conversation history if not exists
  if (!session.conversationHistory) {
    session.conversationHistory = [];
  }

  ws.on("message", handleChatMessage);
  ws.on("error", ws.close);
  ws.on("close", () => {
    cleanupConnection(session.chatConn);
    session.chatConn = undefined;
    if (!session.twilioConn && !session.modelConn && !session.frontendConn) session = {};
  });
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
      closeAllConnections();
      break;
  }
}

function handleFrontendMessage(data: RawData) {
  const msg = parseMessage(data);
  if (!msg) return;

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, msg);
  }

  if (msg.type === "session.update") {
    session.saved_config = msg.session;
  }
}

async function handleChatMessage(data: RawData) {
  const msg = parseMessage(data);
  if (!msg) return;

  console.log("💬 Chat message received:", msg);

  switch (msg.type) {
    case "chat.message":
      await handleTextChatMessage(msg.content);
      break;

    case "session.update":
      session.saved_config = msg.session;
      console.log("📝 Chat session config updated:", msg.session);
      break;

    default:
      console.log("❓ Unknown chat message type:", msg.type);
  }
}

async function handleTextChatMessage(content: string) {
  try {
    console.log("🔤 Processing text message:", content);
    
    // Initialize OpenAI client if needed
    if (!session.openaiClient && session.openAIApiKey) {
      session.openaiClient = new OpenAI({
        apiKey: session.openAIApiKey,
      });
      console.log("✅ OpenAI REST client initialized for text chat");
    }
    
    if (!session.openaiClient) {
      console.error("❌ No OpenAI client available for text chat");
      return;
    }
    
    // Add user message to conversation history
    const userMessage = {
      type: 'user' as const,
      content: content,
      timestamp: Date.now(),
      channel: 'text' as const
    };
    
    if (!session.conversationHistory) {
      session.conversationHistory = [];
    }
    session.conversationHistory.push(userMessage);
    
    // Forward user message to observability clients
    if (isOpen(session.frontendConn)) {
      jsonSend(session.frontendConn, {
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
    
    // Build conversation context for OpenAI REST API
    const messages: ChatCompletionMessageParam[] = session.conversationHistory.map(msg => ({
      role: msg.type === 'user' ? 'user' as const : 'assistant' as const,
      content: msg.content
    }));
    
    console.log("🤖 Calling OpenAI REST API for text response...");
    
    // Import function schemas for supervisor agent
    const allFunctions = getAllFunctions();
    const functionSchemas = allFunctions.map((f: FunctionHandler) => f.schema);
    
    // Call OpenAI REST API for text response with supervisor agent capability
    const completion = await session.openaiClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a fast chat AI assistant with access to a supervisor agent for complex queries. 

For simple conversations, greetings, basic questions, and quick responses, handle them directly.

For complex queries that require:
- Multi-step analysis or planning
- Technical deep-dives
- Creative problem-solving
- Detailed research or reasoning
- Complex calculations or logic

Use the getNextResponseFromSupervisor function to escalate to a more powerful reasoning model.

Be conversational and helpful. When escalating, choose the appropriate reasoning_type and provide good context.`
        },
        ...messages
      ],
      functions: functionSchemas,
      function_call: "auto",
      max_tokens: 500,
      temperature: 0.7,
    });
    
    const message = completion.choices[0]?.message;
    
    // Handle function calls (supervisor agent escalation)
    if (message?.function_call) {
      console.log(`🔧 Function call detected: ${message.function_call.name}`);
      
      // Send function call start event to frontend observability
      if (isOpen(session.frontendConn)) {
        jsonSend(session.frontendConn, {
          type: "response.function_call_arguments.delta",
          name: message.function_call.name,
          arguments: message.function_call.arguments,
          call_id: `call_${Date.now()}`
        });
      }
      
      try {
        // Find and execute the function
        const allFunctions = getAllFunctions();
        const functionHandler = allFunctions.find((f: FunctionHandler) => f.schema.name === message.function_call!.name);
        if (functionHandler) {
          const args = JSON.parse(message.function_call!.arguments);
          console.log(`🧠 Executing ${message.function_call!.name} with args:`, args);
          
          // Create breadcrumb function for supervisor agent nested function calls
          const addBreadcrumb = (title: string, data?: any) => {
            if (isOpen(session.frontendConn)) {
              jsonSend(session.frontendConn, {
                type: "response.function_call_arguments.delta",
                name: title.includes("function call:") ? title.split("function call: ")[1] : title,
                arguments: JSON.stringify(data || {}),
                call_id: `supervisor_${Date.now()}`
              });
            }
          };
          
          const functionResult = await functionHandler.handler(args, addBreadcrumb);
          console.log(`✅ Function result received (${functionResult.length} chars)`);
          
          // Send function call completion event to frontend observability
          if (isOpen(session.frontendConn)) {
            jsonSend(session.frontendConn, {
              type: "response.function_call_arguments.done",
              name: message.function_call.name,
              arguments: message.function_call.arguments,
              call_id: `call_${Date.now()}`,
              status: "completed"
            });
          }
          
          // Parse the supervisor response
          const supervisorData = JSON.parse(functionResult);
          const finalResponse = supervisorData.response || supervisorData.error || "Supervisor agent completed.";
          
          // Add supervisor response to conversation history
          const assistantMessage = {
            type: 'assistant' as const,
            content: finalResponse,
            timestamp: Date.now(),
            channel: 'text' as const
          };
          session.conversationHistory.push(assistantMessage);
          
          // Send supervisor response back to chat client
          if (isOpen(session.chatConn)) {
            jsonSend(session.chatConn, {
              type: "chat.response",
              content: finalResponse,
              timestamp: Date.now(),
              supervisor: supervisorData.escalated || false
            });
          }
          
          // Forward supervisor response to observability clients
          if (isOpen(session.frontendConn)) {
            jsonSend(session.frontendConn, {
              type: "conversation.item.created",
              item: {
                id: `msg_${Date.now()}`,
                type: "message",
                role: "assistant",
                content: [{ type: "text", text: finalResponse }],
                channel: "text",
                supervisor: supervisorData.escalated || false
              }
            });
          }
        } else {
          console.error(`❌ Function handler not found: ${message.function_call!.name}`);
        }
      } catch (error) {
        console.error("❌ Error executing function call:", error);
      }
    }
    // Handle regular text responses
    else if (message?.content) {
      console.log("✅ Received text response from OpenAI:", message.content.substring(0, 100) + "...");
      
      // Add assistant response to conversation history
      const assistantMessage = {
        type: 'assistant' as const,
        content: message.content,
        timestamp: Date.now(),
        channel: 'text' as const
      };
      session.conversationHistory.push(assistantMessage);
      
      // Send response back to chat client
      if (isOpen(session.chatConn)) {
        jsonSend(session.chatConn, {
          type: "chat.response",
          content: message.content,
          timestamp: Date.now()
        });
      }
      
      // Forward assistant response to observability clients
      if (isOpen(session.frontendConn)) {
        jsonSend(session.frontendConn, {
          type: "conversation.item.created",
          item: {
            id: `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: message.content }],
            channel: "text"
          }
        });
      }
    } else {
      console.error("❌ No response content from OpenAI");
    }
    
  } catch (error) {
    console.error("❌ Error in text chat handler:", error);
    
    // Send error response to chat client
    if (isOpen(session.chatConn)) {
      jsonSend(session.chatConn, {
        type: "chat.error",
        error: "Failed to get response from AI",
        timestamp: Date.now()
      });
    }
  }
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
        instructions: `You are a fast voice AI assistant with access to a supervisor agent for complex queries.

For simple conversations, greetings, basic questions, and quick responses, handle them directly with natural speech.

For complex queries that require:
- Multi-step analysis or planning
- Technical deep-dives  
- Creative problem-solving
- Detailed research or reasoning
- Complex calculations or logic

Use the getNextResponseFromSupervisor function to escalate to a more powerful reasoning model.

Be conversational and natural in speech. When escalating, choose the appropriate reasoning_type and provide good context.`,
        ...config,
      },
    });
  });

  session.modelConn.on("message", handleModelMessage);
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

function handleModelMessage(data: RawData) {
  const event = parseMessage(data);
  if (!event) return;

  // Filter events before forwarding to frontend to preserve chat history
  if (shouldForwardToFrontend(event)) {
    jsonSend(session.frontendConn, event);
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
          const assistantMessage: {type: 'user' | 'assistant', content: string, timestamp: number, channel: 'voice' | 'text'} = {
            type: 'assistant' as const,
            content: textContent.text,
            timestamp: Date.now(),
            channel: 'text' as const
          };
          session.conversationHistory.push(assistantMessage);
          
          // Send response back to chat client
          if (isOpen(session.chatConn)) {
            jsonSend(session.chatConn, {
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

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, {
      type: "conversation.item.truncate",
      item_id: session.lastAssistantItem,
      content_index: 0,
      audio_end_ms,
    });
  }

  if (session.twilioConn && session.streamSid) {
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
