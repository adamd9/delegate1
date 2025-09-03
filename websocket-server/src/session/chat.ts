import { RawData, WebSocket } from "ws";
import OpenAI, { ClientOptions } from "openai";
import { ProxyAgent } from "undici";
import { ResponsesTextInput } from "../types";
import { getAgent, getDefaultAgent, FunctionHandler } from "../agentConfigs";
import { executeFunctionCalls, executeFunctionCall } from "../tools/orchestrators/functionCallExecutor";
import { channelInstructions, Channel } from "../agentConfigs/channel";
import { isSmsWindowOpen, getNumbers } from "../smsState";
import { sendSms } from "../sms";
import { session, parseMessage, jsonSend, isOpen } from "./state";
import { ensureSession, appendEvent, ThoughtFlowStepType } from "../observability/thoughtflow";

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
    } else if (msg.type === 'canvas') {
      jsonSend(ws, {
        type: 'chat.canvas',
        content: msg.content,
        title: msg.title,
        timestamp: msg.timestamp,
        id: msg.id,
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
      // Fire-and-forget to avoid blocking the socket. UI will receive chat.working immediately.
      void handleTextChatMessage(msg.content, chatClients, logsClients, 'text');
      break;
    case "chat.cancel": {
      const reqId = msg.request_id as string | undefined;
      if (session.currentRequest && (!reqId || session.currentRequest.id === reqId)) {
        session.currentRequest.canceled = true;
        console.log(`✋ Cancel requested for ${session.currentRequest.id}`);
        try {
          ensureSession();
          appendEvent({ type: 'run.canceled', request_id: session.currentRequest.id, timestamp: Date.now() });
        } catch {}
        // Notify chat clients and logs
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, { type: "chat.canceled", request_id: session.currentRequest.id, timestamp: Date.now() });
        }
        for (const ws of logsClients) {
          if (isOpen(ws)) jsonSend(ws, { type: "chat.canceled", request_id: session.currentRequest.id, timestamp: Date.now() });
        }
        // Clear in-flight marker
        session.currentRequest = undefined;
      }
      break;
    }
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
  logsClients: Set<WebSocket>,
  channel: Channel = 'text'
) {
  try {
    console.log("🔤 Processing text message:", content);
    // Create a new request id and mark as in-flight (cancel any previous text/sms request implicitly for safety)
    const requestId = `req_${Date.now()}`;
    session.currentRequest = { id: requestId, channel, canceled: false, startedAt: Date.now() };
    // ThoughtFlow: ensure session and start run
    ensureSession();
    const runId = `run_${requestId}`;
    appendEvent({ type: 'run.started', run_id: runId, request_id: requestId, channel, started_at: new Date().toISOString() });
    const userStepId = `step_user_${requestId}`;
    appendEvent({ type: 'step.started', run_id: runId, step_id: userStepId , label: ThoughtFlowStepType.UserMessage, payload: { content }, timestamp: Date.now() });
    // Inform UI that work has started
    for (const ws of chatClients) {
      if (isOpen(ws)) jsonSend(ws, { type: "chat.working", request_id: requestId, timestamp: Date.now() });
    }
    // Initialize OpenAI client if needed
    if (!session.openaiClient) {
      if (!process.env.OPENAI_API_KEY) {
        console.error("❌ No OpenAI API key set in environment");
        return;
      }
      const options: ClientOptions = { apiKey: process.env.OPENAI_API_KEY };
      if (process.env.CODEX_CLI === "true" && process.env.HTTPS_PROXY) {
        try {
          const dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
          options.fetch = (url, init: any = {}) => {
            return (globalThis.fetch as any)(url, { ...(init || {}), dispatcher });
          };
          console.debug("OpenAI Client", "Using undici ProxyAgent for Codex environment");
        } catch (e) {
          console.warn("OpenAI Client", "Failed to configure ProxyAgent, continuing without proxy:", e);
        }
      }
      session.openaiClient = new OpenAI(options);
      console.log("✅ OpenAI REST client initialized for text chat");
    }
    // Add user message to conversation history
    const userMessage = {
      type: "user" as const,
      content: content,
      timestamp: Date.now(),
      channel,
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
            channel,
          },
        });
    }
    // Mark user message step as completed for clean duration computation
    appendEvent({ type: 'step.completed', run_id: runId, step_id: userStepId, timestamp: Date.now() });
    // Text channel: expose only base agent tools (supervisor MCP tools are used internally by supervisor flow)
    const baseFunctions = (getAgent('base').tools as FunctionHandler[])
      .filter(Boolean)
      .filter((f: any) => f && f.schema);
    const functionSchemas = baseFunctions.map((f: FunctionHandler) => ({ ...f.schema, strict: false }));
    console.log("🤖 Calling OpenAI Responses API for text response...");
    // Define system instructions
    const baseInstructions = getDefaultAgent().instructions;
    const instructions = [channelInstructions(channel), baseInstructions].join('\n');
    // ThoughtFlow snapshots for long-lived prompt inputs (Approach B)
    const policyHash = Buffer.from(baseInstructions, 'utf8').toString('base64').slice(0, 12);
    const toolsHash = Buffer.from(JSON.stringify(functionSchemas), 'utf8').toString('base64').slice(0, 12);
    const policyStepId = `snp_policy_${policyHash}`;
    const toolsStepId = `snp_tools_${toolsHash}`;
    const channelStepId = `snp_channel_${channel}`;
    appendEvent({ type: 'step.started', run_id: runId, step_id: policyStepId, label: 'policy.snapshot', payload: { version: policyHash, produced_at: (session.thoughtflow as any)?.startedAt || Date.now(), content_preview: baseInstructions.slice(0, 240) }, timestamp: Date.now() });
    appendEvent({ type: 'step.completed', run_id: runId, step_id: policyStepId, timestamp: Date.now() });
    appendEvent({ type: 'step.started', run_id: runId, step_id: toolsStepId, label: 'tool.schemas.snapshot', payload: { version: toolsHash, count: functionSchemas.length }, timestamp: Date.now() });
    appendEvent({ type: 'step.completed', run_id: runId, step_id: toolsStepId, timestamp: Date.now() });
    appendEvent({ type: 'step.started', run_id: runId, step_id: channelStepId, label: 'channel.preamble', payload: { channel }, timestamp: Date.now() });
    appendEvent({ type: 'step.completed', run_id: runId, step_id: channelStepId, timestamp: Date.now() });
    // Prepare request body for Responses API
    const requestBody: any = {
      model: getAgent('base').textModel || getAgent('base').model || "gpt-5-mini",
      reasoning: {
        effort: 'minimal' as const,
      },
      instructions: instructions,
      tools: functionSchemas,
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
    // ThoughtFlow: LLM tool_call with prompt_provenance (Approach B)
    const llmStepId = `step_llm_${requestId}`;
    const provenanceParts = [
      { type: 'channel_preamble', value: channelInstructions(channel) },
      { type: 'personality', value: baseInstructions },
      ...(session.previousResponseId ? [{ type: 'previous_response_id', value: String(session.previousResponseId) }] : []),
      { type: 'user_instruction', value: content },
      { type: 'tool_schemas_snapshot', value: `tools:${functionSchemas.length}` },
    ];
    const promptProvenance = {
      parts: provenanceParts,
      final_prompt: instructions,
      assembly: [
        { part: 0, start: 0, end: channelInstructions(channel).length },
        { part: 1, start: channelInstructions(channel).length + 1, end: instructions.length }
      ]
    };
    appendEvent({
      type: 'step.started',
      run_id: runId,
      step_id: llmStepId,
      label: ThoughtFlowStepType.ToolCall,
      depends_on: [userStepId, policyStepId, toolsStepId, channelStepId],
      payload: {
        name: 'openai.responses.create',
        model: requestBody.model,
        arguments: { instructions_preview: instructions.slice(0, 200), tools_count: functionSchemas.length },
        prompt_provenance: promptProvenance,
      },
      timestamp: Date.now(),
    });
    const response = await session.openaiClient.responses.create(requestBody);
    appendEvent({ type: 'step.completed', run_id: runId, step_id: llmStepId, payload: { meta: { status: 'ok' } }, timestamp: Date.now() });
    // If canceled mid-flight, abort committing
    if (!session.currentRequest || session.currentRequest.id !== requestId || session.currentRequest.canceled) {
      console.log(`[${requestId}] Aborting post-response handling due to cancel`);
      appendEvent({ type: 'run.aborted', run_id: runId, request_id: requestId, timestamp: Date.now() });
      return;
    }
    // Persist thread state regardless of tool usage so subsequent turns chain correctly
    session.previousResponseId = response.id;
    console.log(
      "[DEBUG] Responses API Response:",
      JSON.stringify(
        { id: response.id, output_text: response.output_text, output: response.output },
        null,
        2
      )
    );
    // Emit tool_output for LLM text before branching into tool calls
    const llmOutStepId = `step_llm_output_${requestId}`;
    appendEvent({ type: 'step.started', run_id: runId, step_id: llmOutStepId, label: ThoughtFlowStepType.ToolOutput, depends_on: llmStepId, payload: { output: response.output_text || response.output }, timestamp: Date.now() });
    appendEvent({ type: 'step.completed', run_id: runId, step_id: llmOutStepId, timestamp: Date.now() });
    const functionCalls = response.output?.filter((output: any) => output.type === "function_call");
    if (functionCalls && functionCalls.length > 0) {
      const functionCall = functionCalls[0];
      const toolStepId = `step_tool_${functionCall.call_id}`;
      // Defer both console logging and breadcrumb emission to the orchestrator for consistency
      // --- SMS placeholder for tool call ---
      if (isSmsWindowOpen()) {
        const { smsUserNumber, smsTwilioNumber } = getNumbers();
        sendSms("...", smsTwilioNumber, smsUserNumber).catch((e) => console.error("sendSms error", e));
      }
      try {
        const allFns = getAgent('base').tools as FunctionHandler[];
        const functionHandler = allFns.find((f: FunctionHandler) => f.schema.name === functionCall.name);
        if (functionHandler) {
          const args = JSON.parse(functionCall.arguments);
          // Execute via orchestrator to standardize breadcrumbs and completion
          appendEvent({ type: 'step.started', run_id: runId, step_id: toolStepId, label: ThoughtFlowStepType.ToolCall, payload: { name: functionCall.name, arguments: functionCall.arguments }, depends_on: userStepId, timestamp: Date.now() });
          const functionResult = await executeFunctionCall(
            { name: functionCall.name, arguments: functionCall.arguments, call_id: functionCall.call_id },
            { mode: 'chat', logsClients, confirm: false }
          );
          appendEvent({ type: 'step.completed', run_id: runId, step_id: toolStepId, payload: { meta: { status: 'ok' } }, timestamp: Date.now() });
          // Emit a separate tool_output step that depends on the tool call
          const toolOutputStepId = `step_tool_output_${functionCall.call_id}`;
          appendEvent({ type: 'step.started', run_id: runId, step_id: toolOutputStepId, label: ThoughtFlowStepType.ToolOutput, depends_on: toolStepId, payload: { output: functionResult }, timestamp: Date.now() });
          appendEvent({ type: 'step.completed', run_id: runId, step_id: toolOutputStepId, timestamp: Date.now() });
          // Check cancel before proceeding
          if (!session.currentRequest || session.currentRequest.id !== requestId || session.currentRequest.canceled) {
            console.log(`[${requestId}] Aborting after tool execution due to cancel`);
            appendEvent({ type: 'run.aborted', run_id: runId, request_id: requestId, timestamp: Date.now() });
            return;
          }
          // Orchestrator prints the standard result log
          const fnSchemas = allFns.map((f: FunctionHandler) => ({ ...f.schema, strict: false }));
          const followUpBody = {
            model: getAgent('base').textModel || getAgent('base').model || "gpt-5-mini",
            reasoning: {
              effort: 'minimal' as const,
            },
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
          };
          console.log("[DEBUG] Follow-up Responses API request:", JSON.stringify(followUpBody, null, 2));
          const followUpResponse = await session.openaiClient.responses.create(followUpBody);
          if (!session.currentRequest || session.currentRequest.id !== requestId || session.currentRequest.canceled) {
            console.log(`[${requestId}] Aborting after follow-up due to cancel`);
            appendEvent({ type: 'run.aborted', run_id: runId, request_id: requestId, timestamp: Date.now() });
            return;
          }
          console.log(
            "[DEBUG] Follow-up Responses API response:",
            JSON.stringify(
              { id: followUpResponse.id, output_text: followUpResponse.output_text, output: followUpResponse.output },
              null,
              2
            )
          );
          session.previousResponseId = followUpResponse.id;
          const fuFunctionCalls = followUpResponse.output?.filter((o: any) => o.type === "function_call");
          if (fuFunctionCalls && fuFunctionCalls.length > 0) {
            // Delegate to orchestrator to execute one function_call (canvas preferred) and optionally confirm
            const { handled, confirmText, confirmResponseId } = await executeFunctionCalls(
              fuFunctionCalls,
              {
                mode: 'chat',
                logsClients,
                openaiClient: session.openaiClient,
                previousResponseId: followUpResponse.id,
                confirm: true,
              }
            );
            if (handled) {
              if (confirmResponseId) session.previousResponseId = confirmResponseId;
              const text = confirmText || followUpResponse.output_text || "(action completed)";
              const assistantStepId_handled = `step_assistant_${Date.now()}`;
              appendEvent({ type: 'step.started', run_id: runId, step_id: assistantStepId_handled, label: ThoughtFlowStepType.AssistantMessage, payload: { text }, depends_on: toolOutputStepId, timestamp: Date.now() });
              const assistantMessage = {
                type: 'assistant' as const,
                content: text,
                timestamp: Date.now(),
                channel: 'text' as const,
                supervisor: true,
              };
              session.conversationHistory.push(assistantMessage);
              if (isSmsWindowOpen()) {
                const { smsUserNumber, smsTwilioNumber } = getNumbers();
                sendSms(text, smsTwilioNumber, smsUserNumber).catch((e) => console.error('sendSms error', e));
              }
              for (const ws of chatClients) {
                if (isOpen(ws)) jsonSend(ws, { type: 'chat.response', content: text, timestamp: Date.now(), supervisor: true });
              }
              for (const ws of chatClients) {
                if (isOpen(ws)) jsonSend(ws, { type: 'chat.done', request_id: requestId, timestamp: Date.now() });
              }
              session.currentRequest = undefined;
              // Also forward to logs history for symmetry
              for (const ws of logsClients) {
                if (isOpen(ws))
                  jsonSend(ws, {
                    type: 'conversation.item.created',
                    item: {
                      id: `msg_${Date.now()}`,
                      type: 'message',
                      role: 'assistant',
                      content: [{ type: 'text', text }],
                      channel: 'text',
                      supervisor: true,
                    },
                  });
              }
              appendEvent({ type: 'step.completed', run_id: runId, step_id: assistantStepId_handled, timestamp: Date.now() });
              appendEvent({ type: 'run.completed', run_id: runId, request_id: requestId, ended_at: new Date().toISOString() });
              return;
            }
          }
          const finalResponse = followUpResponse.output_text || "Supervisor agent completed.";
          const assistantStepId_supervisor = `step_assistant_${Date.now()}`;
          appendEvent({ type: 'step.started', run_id: runId, step_id: assistantStepId_supervisor, label: ThoughtFlowStepType.AssistantMessage, payload: { text: finalResponse }, depends_on: toolOutputStepId, timestamp: Date.now() });
          const assistantMessage = {
            type: "assistant" as const,
            content: finalResponse,
            timestamp: Date.now(),
            channel: "text" as const,
            supervisor: true,
          };
          session.conversationHistory.push(assistantMessage);
          if (isSmsWindowOpen()) {
            const { smsUserNumber, smsTwilioNumber } = getNumbers();
            sendSms(finalResponse, smsTwilioNumber, smsUserNumber).catch((e) =>
              console.error("sendSms error", e)
            );
          }
          for (const ws of chatClients) {
            if (isOpen(ws))
              jsonSend(ws, {
                type: "chat.response",
                content: finalResponse,
                timestamp: Date.now(),
                supervisor: true,
              });
          }
          for (const ws of chatClients) {
            if (isOpen(ws)) jsonSend(ws, { type: "chat.done", request_id: requestId, timestamp: Date.now() });
          }
          session.currentRequest = undefined;
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
          appendEvent({ type: 'step.completed', run_id: runId, step_id: assistantStepId_supervisor, timestamp: Date.now() });
          appendEvent({ type: 'run.completed', run_id: runId, request_id: requestId, ended_at: new Date().toISOString() });
          return;
        }
      } catch (err: any) {
        console.error("❌ Error executing function call:", err);
        // Gracefully notify user and finalize this request to avoid stalling the chat
        const toolName = (functionCall && functionCall.name) ? functionCall.name : 'tool';
        const errMsg = err?.message || 'unknown error';
        const errorText = `Observation: ${toolName} failed: ${errMsg}. I won't block the chat; you can continue while I remain operational.`;
        const assistantMessage = {
          type: "assistant" as const,
          content: errorText,
          timestamp: Date.now(),
          channel: "text" as const,
          supervisor: true,
        };
        session.conversationHistory.push(assistantMessage);
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, { type: "chat.response", content: errorText, timestamp: Date.now(), supervisor: true });
        }
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, { type: "chat.done", request_id: requestId, timestamp: Date.now() });
        }
        session.currentRequest = undefined;
        // Also forward to logs for observability
        for (const ws of logsClients) {
          if (isOpen(ws))
            jsonSend(ws, {
              type: "conversation.item.created",
              item: {
                id: `msg_${Date.now()}`,
                type: "message",
                role: "assistant",
                content: [{ type: "text", text: errorText }],
                channel: "text",
                supervisor: true,
              },
            });
        }
        appendEvent({ type: 'step.completed', run_id: runId, step_id: `step_error_${Date.now()}`, label: ThoughtFlowStepType.ToolError, payload: { error: err?.message || String(err) }, timestamp: Date.now() });
        appendEvent({ type: 'run.completed', run_id: runId, request_id: requestId, ended_at: new Date().toISOString(), status: 'error' });
        return;
      }
    }
    // Fallback to assistant text output
    const assistantText = response.output_text || "(No text output)";
    const assistantStepId_fallback = `step_assistant_${Date.now()}`;
    appendEvent({ type: 'step.started', run_id: runId, step_id: assistantStepId_fallback, label: ThoughtFlowStepType.AssistantMessage, payload: { text: assistantText }, depends_on: llmOutStepId, timestamp: Date.now() });
    const assistantMessage = {
      type: "assistant" as const,
      content: assistantText,
      timestamp: Date.now(),
      channel: "text" as const,
      supervisor: false,
    };
    session.conversationHistory.push(assistantMessage);
    if (isSmsWindowOpen()) {
      const { smsUserNumber, smsTwilioNumber } = getNumbers();
      sendSms(assistantText, smsTwilioNumber, smsUserNumber).catch((e) =>
        console.error("sendSms error", e)
      );
    }
    for (const ws of chatClients) {
      if (isOpen(ws))
        jsonSend(ws, { type: "chat.response", content: assistantText, timestamp: Date.now() });
    }
    for (const ws of chatClients) {
      if (isOpen(ws)) jsonSend(ws, { type: "chat.done", request_id: requestId, timestamp: Date.now() });
    }
    session.currentRequest = undefined;
    appendEvent({ type: 'step.completed', run_id: runId, step_id: assistantStepId_fallback, timestamp: Date.now() });
    appendEvent({ type: 'run.completed', run_id: runId, request_id: requestId, ended_at: new Date().toISOString() });
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
    // Ensure clients are unblocked on error
    if (session.currentRequest) {
      for (const ws of chatClients) {
        if (isOpen(ws)) jsonSend(ws, { type: "chat.canceled", request_id: session.currentRequest.id, error: "server_error", timestamp: Date.now() });
      }
      session.currentRequest = undefined;
    }
  }
}
