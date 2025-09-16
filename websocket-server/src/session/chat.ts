import { RawData, WebSocket } from "ws";
import OpenAI, { ClientOptions } from "openai";
import { ProxyAgent } from "undici";
import { ResponsesTextInput } from "../types";
import { getAgent, getDefaultAgent, FunctionHandler } from "../agentConfigs";
import { executeFunctionCalls, executeFunctionCall } from "../tools/orchestrators/functionCallExecutor";
import { contextInstructions, Context, Channel } from "../agentConfigs/context";
import { isSmsWindowOpen, getNumbers } from "../smsState";
import { sendSms } from "../sms";
import { getReplyTo } from "../emailState";
import { sendEmail } from "../email";
import { session, parseMessage, jsonSend, isOpen } from "./state";
import { listConversations as dbListConversations, listConversationEvents, completeConversation } from "../db/sqlite";
import { ensureSession, appendEvent, ThoughtFlowStepType, endSession } from "../observability/thoughtflow";
import { addConversationEvent } from "../db/sqlite";

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
  // Do not replay backlog on chat websocket connect; history is handled by REST hydration.
  ws.on("message", (data) => processChatSocketMessage(data, chatClients, logsClients, ws));
  ws.on("error", ws.close);
  // No session cleanup here; handled by Set in server.ts
  // Auto-replay on connect: send ended runs (history) and the current open run, if any
  try {
    const limit = Math.max(1, Math.min(50, Number(process.env.SESSION_HISTORY_LIMIT || 3)));
    const conversations: any[] = dbListConversations(limit) || [];
    const ended = conversations.filter((c: any) => Boolean(c.ended_at));
    const open = conversations.find((c: any) => !c.ended_at);
    // Header for history section (ended runs only)
    if (isOpen(ws)) jsonSend(ws, { type: 'history.header', count: ended.length });
    // Replay ended runs under history (replay: true)
    for (const conv of ended) {
      const convId = conv.id;
      const events = listConversationEvents(convId) as any[];
      const base = (Array.isArray(events) && events.length > 0 && events[0].created_at_ms) || Date.now();
      const seenKinds = new Set<string>();
      for (const e of events) {
        const kind = e.kind as string;
        const payload = typeof e.payload_json === 'string' ? (() => { try { return JSON.parse(e.payload_json); } catch { return {}; } })() : (e.payload || {});
        const ts = (typeof e.seq === 'number' ? (base + e.seq) : (e.created_at_ms || Date.now()));
        if (kind === 'thoughtflow_artifacts') {
          if (seenKinds.has('thoughtflow_artifacts')) continue;
          seenKinds.add('thoughtflow_artifacts');
        }
        if (kind === 'message_user' || kind === 'message_assistant') {
          jsonSend(ws, {
            type: 'conversation.item.created',
            replay: true,
            session_id: conv.session_id,
            conversation_id: convId,
            item: {
              id: `ti_${e.seq}`,
              type: 'message',
              role: kind === 'message_user' ? 'user' : 'assistant',
              content: [{ type: 'text', text: String(payload.text || '') }],
              channel: payload.channel || 'text',
              supervisor: Boolean(payload.supervisor),
            },
            timestamp: ts,
          } as any);
        } else if (kind === 'function_call_created') {
          jsonSend(ws, {
            type: 'conversation.item.created',
            replay: true,
            session_id: conv.session_id,
            conversation_id: convId,
            item: {
              id: String(payload.call_id || `call_${e.seq}`),
              type: 'function_call',
              name: payload.name || 'tool',
              call_id: payload.call_id || `call_${e.seq}`,
              arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
              status: 'created',
            },
            timestamp: ts,
          } as any);
        } else if (kind === 'function_call_completed') {
          jsonSend(ws, {
            type: 'conversation.item.completed',
            replay: true,
            session_id: conv.session_id,
            conversation_id: convId,
            item: {
              id: String(payload.call_id || `call_${e.seq}`),
              type: 'function_call',
              name: payload.name || 'tool',
              call_id: payload.call_id || `call_${e.seq}`,
              arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
              status: 'completed',
              result: typeof payload.result === 'string' ? payload.result : (payload.result ? JSON.stringify(payload.result) : undefined),
            },
            timestamp: ts,
          } as any);
        } else if (kind === 'canvas') {
          jsonSend(ws, {
            type: 'chat.canvas',
            replay: true,
            session_id: conv.session_id,
            conversation_id: convId,
            content: payload.url,
            title: payload.title,
            timestamp: ts,
            id: payload.id,
          } as any);
        } else if (kind === 'thoughtflow_artifacts') {
          jsonSend(ws, {
            type: 'thoughtflow.artifacts',
            replay: true,
            session_id: conv.session_id,
            conversation_id: convId,
            json_path: payload.json_path,
            d2_path: payload.d2_path,
            url_json: payload.url_json,
            url_d2: payload.url_d2,
            url_d2_raw: payload.url_d2_raw,
            url_d2_viewer: payload.url_d2_viewer,
            timestamp: ts,
          } as any);
        }
      }
    }
    // Replay current open run (if any) into the live area (replay: false)
    if (open) {
      const convId = open.id;
      const events = listConversationEvents(convId) as any[];
      const base = (Array.isArray(events) && events.length > 0 && events[0].created_at_ms) || Date.now();
      const seenKinds = new Set<string>();
      for (const e of events) {
        const kind = e.kind as string;
        const payload = typeof e.payload_json === 'string' ? (() => { try { return JSON.parse(e.payload_json); } catch { return {}; } })() : (e.payload || {});
        const ts = (typeof e.seq === 'number' ? (base + e.seq) : (e.created_at_ms || Date.now()));
        if (kind === 'thoughtflow_artifacts') {
          if (seenKinds.has('thoughtflow_artifacts')) continue;
          seenKinds.add('thoughtflow_artifacts');
        }
        if (kind === 'message_user' || kind === 'message_assistant') {
          jsonSend(ws, {
            type: 'conversation.item.created',
            session_id: open.session_id,
            conversation_id: convId,
            item: {
              id: `ti_${e.seq}`,
              type: 'message',
              role: kind === 'message_user' ? 'user' : 'assistant',
              content: [{ type: 'text', text: String(payload.text || '') }],
              channel: payload.channel || 'text',
              supervisor: Boolean(payload.supervisor),
            },
            timestamp: ts,
          } as any);
        } else if (kind === 'function_call_created') {
          jsonSend(ws, {
            type: 'conversation.item.created',
            session_id: open.session_id,
            conversation_id: convId,
            item: {
              id: String(payload.call_id || `call_${e.seq}`),
              type: 'function_call',
              name: payload.name || 'tool',
              call_id: payload.call_id || `call_${e.seq}`,
              arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
              status: 'created',
            },
            timestamp: ts,
          } as any);
        } else if (kind === 'function_call_completed') {
          jsonSend(ws, {
            type: 'conversation.item.completed',
            session_id: open.session_id,
            conversation_id: convId,
            item: {
              id: String(payload.call_id || `call_${e.seq}`),
              type: 'function_call',
              name: payload.name || 'tool',
              call_id: payload.call_id || `call_${e.seq}`,
              arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
              status: 'completed',
              result: typeof payload.result === 'string' ? payload.result : (payload.result ? JSON.stringify(payload.result) : undefined),
            },
            timestamp: ts,
          } as any);
        } else if (kind === 'canvas') {
          jsonSend(ws, {
            type: 'chat.canvas',
            session_id: open.session_id,
            conversation_id: convId,
            content: payload.url,
            title: payload.title,
            timestamp: ts,
            id: payload.id,
          } as any);
        }
      }
    }
  } catch (e) {
    console.warn('[chat] auto history replay failed:', (e as any)?.message || e);
  }
}

export async function processChatSocketMessage(
  data: RawData,
  chatClients: Set<WebSocket>,
  logsClients: Set<WebSocket>,
  requester?: WebSocket
) {
  const msg = parseMessage(data);
  if (!msg) return;
  console.log("💬 Chat message received:", msg);
  switch (msg.type) {
    case "conversation.end": {
      try {
        // Require an explicit conversation_id; keep logic simple and predictable
        const targetConvId: string | undefined = (msg as any).conversation_id;
        if (!targetConvId) {
          if (requester && isOpen(requester)) jsonSend(requester, { type: 'conversation.finalized', ok: false, error: 'conversation_id_required', timestamp: Date.now() });
          break;
        }
        // Mark conversation completed now
        const endedAt = new Date().toISOString();
        completeConversation({ id: targetConvId, status: 'completed', ended_at: endedAt });
        // Emit a ThoughtFlow event so artifact generation and ledger entries are produced
        try {
          appendEvent({ type: 'conversation.completed', conversation_id: targetConvId, ended_at: endedAt, status: 'completed' });
        } catch {}
        // Broadcast to all chat clients
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, { type: 'conversation.finalized', conversation_id: targetConvId, ok: true, ended_at: endedAt, timestamp: Date.now() });
        }
      } catch (e: any) {
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, { type: 'conversation.finalized', ok: false, error: e?.message || String(e), timestamp: Date.now() });
        }
      }
      break;
    }
    case "session.end": {
      try {
        // Ensure a session exists and finalize it
        const { id } = ensureSession();
        const result = endSession();
        // Clear previousResponseId so a new run starts fresh
        try { (session as any).previousResponseId = undefined; } catch {}
        // Notify all chat clients that the session was finalized
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, { type: 'session.finalized', session_id: id, ok: Boolean(result), timestamp: Date.now() });
        }
      } catch (e: any) {
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, { type: 'session.finalized', error: e?.message || String(e), timestamp: Date.now() });
        }
      }
      break;
    }
    case "history.request": {
      try {
        const limit = Math.max(1, Math.min(50, Number((msg as any).limit) || Number(process.env.SESSION_HISTORY_LIMIT || 3)));
        const conversations: any[] = dbListConversations(limit) || [];
        console.debug(`[history.request] limit=${limit} conversations=${conversations.length}`);
        // Only include ended conversations for history; exclude any active/un-ended runs
        const include = conversations.filter((c: any) => Boolean(c.ended_at));
        if (requester && isOpen(requester)) {
          jsonSend(requester, { type: 'history.header', count: include.length });
        }
        for (const conv of include) {
          const convId = conv.id;
          const events = listConversationEvents(convId) as any[];
          console.debug(`[history.request] conv=${convId} events=${events.length}`);
          // Establish a base timestamp and strictly order by seq
          const base = (Array.isArray(events) && events.length > 0 && events[0].created_at_ms) || Date.now();
          const seenKinds = new Set<string>();
          for (const e of events) {
            const kind = e.kind as string;
            const payload = typeof e.payload_json === 'string' ? (() => { try { return JSON.parse(e.payload_json); } catch { return {}; } })() : (e.payload || {});
            const ts = (typeof e.seq === 'number' ? (base + e.seq) : (e.created_at_ms || Date.now()));
            if (kind === 'thoughtflow_artifacts') {
              if (seenKinds.has('thoughtflow_artifacts')) continue;
              seenKinds.add('thoughtflow_artifacts');
            }
            if (kind === 'message_user' || kind === 'message_assistant') {
              const evt = {
                type: 'conversation.item.created',
                replay: true,
                session_id: conv.session_id,
                conversation_id: convId,
                item: {
                  id: `ti_${e.seq}`,
                  type: 'message',
                  role: kind === 'message_user' ? 'user' : 'assistant',
                  content: [{ type: 'text', text: String(payload.text || '') }],
                  channel: payload.channel || 'text',
                  supervisor: Boolean(payload.supervisor),
                },
                timestamp: ts,
              } as any;
              if (requester && isOpen(requester)) jsonSend(requester, evt);
            } else if (kind === 'function_call_created') {
              const evt = {
                type: 'conversation.item.created',
                replay: true,
                session_id: conv.session_id,
                conversation_id: convId,
                item: {
                  id: String(payload.call_id || `call_${e.seq}`),
                  type: 'function_call',
                  name: payload.name || 'tool',
                  call_id: payload.call_id || `call_${e.seq}`,
                  arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
                  status: 'created',
                },
                timestamp: ts,
              } as any;
              if (requester && isOpen(requester)) jsonSend(requester, evt);
            } else if (kind === 'function_call_completed') {
              const evt = {
                type: 'conversation.item.completed',
                replay: true,
                session_id: conv.session_id,
                conversation_id: convId,
                item: {
                  id: String(payload.call_id || `call_${e.seq}`),
                  type: 'function_call',
                  name: payload.name || 'tool',
                  call_id: payload.call_id || `call_${e.seq}`,
                  arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
                  status: 'completed',
                  result: typeof payload.result === 'string' ? payload.result : (payload.result ? JSON.stringify(payload.result) : undefined),
                },
                timestamp: ts,
              } as any;
              if (requester && isOpen(requester)) jsonSend(requester, evt);
            } else if (kind === 'canvas') {
              const evt = {
                type: 'chat.canvas',
                replay: true,
                session_id: conv.session_id,
                conversation_id: convId,
                content: payload.url,
                title: payload.title,
                timestamp: ts,
                id: payload.id,
              } as any;
              if (requester && isOpen(requester)) jsonSend(requester, evt);
            } else if (kind === 'thoughtflow_artifacts') {
              const evt = {
                type: 'thoughtflow.artifacts',
                replay: true,
                session_id: conv.session_id,
                conversation_id: convId,
                json_path: payload.json_path,
                d2_path: payload.d2_path,
                url_json: payload.url_json,
                url_d2: payload.url_d2,
                url_d2_raw: payload.url_d2_raw,
                url_d2_viewer: payload.url_d2_viewer,
                timestamp: ts,
              } as any;
              if (requester && isOpen(requester)) jsonSend(requester, evt);
            }
          }
        }
      } catch (e) {
        console.warn('history.request failed', e);
      }
      break;
    }
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
          appendEvent({ type: 'conversation.aborted', conversation_id: `run_${session.currentRequest.id}`, request_id: session.currentRequest.id, timestamp: Date.now() });
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
  channel: Channel = 'text',
  metadata: { subject?: string } = {}
) {
  const context: Context = {
    channel,
    currentTime: new Date().toLocaleString(),
  };
  try {
    console.log("🔤 Processing text message:", content);
    // Create a new request id and mark as in-flight (cancel any previous text/sms request implicitly for safety)
    const requestId = `req_${Date.now()}`;
    session.currentRequest = { id: requestId, channel, canceled: false, startedAt: Date.now() };
    // ThoughtFlow: ensure session and start run
    const { id: sessionId } = ensureSession();
    const conversationId = `run_${requestId}`;
    appendEvent({ type: 'conversation.started', conversation_id: conversationId, request_id: requestId, channel, started_at: new Date().toISOString() });
    const userStepId = `step_user_${requestId}`;
    appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: userStepId , label: ThoughtFlowStepType.UserMessage, payload: { content }, timestamp: Date.now() });
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
    try {
      addConversationEvent({
        conversation_id: conversationId,
        kind: 'message_user',
        payload: { text: content, channel, supervisor: false },
        created_at_ms: userMessage.timestamp,
      });
    } catch {}
    // (Removed) Early user emit without metadata to avoid duplication. We will emit once below with meta.
    // Mark user message step as completed for clean duration computation
    appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: userStepId, timestamp: Date.now() });
    // Emit user message to logs websocket with metadata so UI can show conversation/session IDs live
    try {
      for (const ws of logsClients) {
        if (isOpen(ws))
          jsonSend(ws, {
            type: 'conversation.item.created',
            session_id: sessionId,
            conversation_id: conversationId,
            item: {
              id: `msg_${Date.now()}`,
              type: 'message',
              role: 'user',
              content: [{ type: 'text', text: content }],
              channel,
            },
            timestamp: Date.now(),
          });
      }
    } catch {}
    // Text channel: expose only base agent tools (supervisor MCP tools are used internally by supervisor flow)
    const baseFunctions = (getAgent('base').tools as FunctionHandler[])
      .filter(Boolean)
      .filter((f: any) => f && f.schema);
    const functionSchemas = baseFunctions.map((f: FunctionHandler) => ({ ...f.schema, strict: false }));
    console.log("🤖 Calling OpenAI Responses API for text response...");
    // Define system instructions
    const baseInstructions = getDefaultAgent().instructions;
    const contextInstructionString = contextInstructions(context);
    const instructions = [contextInstructionString, baseInstructions].join('\n');
    // ThoughtFlow snapshots for long-lived prompt inputs (Approach B)
    const policyHash = Buffer.from(baseInstructions, 'utf8').toString('base64').slice(0, 12);
    const toolsHash = Buffer.from(JSON.stringify(functionSchemas), 'utf8').toString('base64').slice(0, 12);
    const policyStepId = `snp_policy_${policyHash}`;
    const toolsStepId = `snp_tools_${toolsHash}`;
    const contextStepId = `snp_context_${requestId}`;
    appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: policyStepId, label: 'policy.snapshot', payload: { version: policyHash, produced_at: (session.thoughtflow as any)?.startedAt || Date.now(), content_preview: baseInstructions.slice(0, 240) }, timestamp: Date.now() });
    appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: policyStepId, timestamp: Date.now() });
    const toolNames = functionSchemas.map((s: any) => s?.name).filter(Boolean);
    const schemasPreview = JSON.stringify(functionSchemas.slice(0, 3), null, 2);
    appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: toolsStepId, label: 'tool.schemas.snapshot', payload: { version: toolsHash, count: functionSchemas.length, names: toolNames, schemas_preview: schemasPreview }, timestamp: Date.now() });
    appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: toolsStepId, timestamp: Date.now() });
    appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: contextStepId, label: 'context.preamble', payload: { context }, timestamp: Date.now() });
    appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: contextStepId, timestamp: Date.now() });
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
      { type: 'context_preamble', value: contextInstructionString },
      { type: 'personality', value: baseInstructions },
      ...(session.previousResponseId ? [{ type: 'previous_response_id', value: String(session.previousResponseId) }] : []),
      { type: 'user_instruction', value: content },
      { type: 'tool_schemas_snapshot', value: `tools:${functionSchemas.length}` },
    ];
    const promptProvenance = {
      parts: provenanceParts,
      final_prompt: instructions,
      assembly: [
        { part: 0, start: 0, end: contextInstructionString.length },
        { part: 1, start: contextInstructionString.length + 1, end: instructions.length }
      ]
    };
    appendEvent({
      type: 'step.started',
      conversation_id: conversationId,
      step_id: llmStepId,
      label: ThoughtFlowStepType.AssistantCall,
      depends_on: [userStepId, policyStepId, toolsStepId, contextStepId],
      payload: {
        name: 'openai.responses.create',
        model: requestBody.model,
        arguments: { instructions_preview: instructions.slice(0, 200), tools_count: functionSchemas.length },
        prompt_provenance: promptProvenance,
      },
      timestamp: Date.now(),
    });
    const response = await session.openaiClient.responses.create(requestBody);
    // If canceled mid-flight, abort committing
    if (!session.currentRequest || session.currentRequest.id !== requestId || session.currentRequest.canceled) {
      console.log(`[${requestId}] Aborting post-response handling due to cancel`);
      // Still mark step as completed but with cancel status
      appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: llmStepId, payload: { meta: { status: 'canceled' } }, timestamp: Date.now() });
      appendEvent({ type: 'conversation.aborted', conversation_id: conversationId, request_id: requestId, timestamp: Date.now() });
      return;
    }

    // Consolidate LLM output into the AssistantCall's completed payload
    const functionCalls = response.output?.filter((o: any) => o.type === 'function_call') || [];
    const assistantOutputPayload = {
      text: response.output_text,
      function_calls: functionCalls.map((fc: any) => ({ name: fc.name, args: fc.arguments, call_id: fc.call_id })),
      response_id: response.id,
    };
    appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: llmStepId, payload: assistantOutputPayload, timestamp: Date.now() });

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
          appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: toolStepId, label: ThoughtFlowStepType.ToolCall, payload: { name: functionCall.name, arguments: functionCall.arguments }, depends_on: llmStepId, timestamp: Date.now() });
          const functionResult = await executeFunctionCall(
            { name: functionCall.name, arguments: functionCall.arguments, call_id: functionCall.call_id },
            { mode: 'chat', logsClients, confirm: false }
          );
          // Consolidate tool output into the ToolCall's completed payload
          const toolOutputPayload = {
            output: functionResult,
            meta: { status: 'ok' },
          };
          appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: toolStepId, payload: toolOutputPayload, timestamp: Date.now() });

          // Check cancel before proceeding
          if (!session.currentRequest || session.currentRequest.id !== requestId || session.currentRequest.canceled) {
            console.log(`[${requestId}] Aborting after tool execution due to cancel`);
            appendEvent({ type: 'conversation.aborted', conversation_id: conversationId, request_id: requestId, timestamp: Date.now() });
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
            appendEvent({ type: 'conversation.aborted', conversation_id: conversationId, request_id: requestId, timestamp: Date.now() });
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
              appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: assistantStepId_handled, label: ThoughtFlowStepType.AssistantMessage, payload: { text }, depends_on: toolStepId, timestamp: Date.now() });
              const assistantMessage = {
                type: 'assistant' as const,
                content: text,
                timestamp: Date.now(),
                channel: 'text' as const,
                supervisor: true,
              };
              session.conversationHistory.push(assistantMessage);
              try {
                addConversationEvent({
                  conversation_id: conversationId,
                  kind: 'message_assistant',
                  payload: { text, channel: 'text', supervisor: true },
                  created_at_ms: assistantMessage.timestamp,
                });
              } catch {}
              if (isSmsWindowOpen()) {
                const { smsUserNumber, smsTwilioNumber } = getNumbers();
                sendSms(text, smsTwilioNumber, smsUserNumber).catch((e) => console.error('sendSms error', e));
              }
              for (const ws of chatClients) {
                if (isOpen(ws)) jsonSend(ws, { type: 'chat.response', content: text, timestamp: Date.now(), supervisor: true, session_id: sessionId, conversation_id: conversationId });
              }
              for (const ws of chatClients) {
                if (isOpen(ws)) jsonSend(ws, { type: 'chat.done', request_id: requestId, timestamp: Date.now() });
              }
              session.currentRequest = undefined;
              // No additional logs emit to avoid duplicate assistant messages; chat.response carries meta now.
              appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: assistantStepId_handled, timestamp: Date.now() });
              return;
            }
          }
          const finalResponse = followUpResponse.output_text || "Supervisor agent completed.";
          const assistantStepId_supervisor = `step_assistant_${Date.now()}`;
          appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: assistantStepId_supervisor, label: ThoughtFlowStepType.AssistantMessage, payload: { text: finalResponse }, depends_on: toolStepId, timestamp: Date.now() });
          const assistantMessage = {
            type: "assistant" as const,
            content: finalResponse,
            timestamp: Date.now(),
            channel: "text" as const,
            supervisor: true,
          };
          session.conversationHistory.push(assistantMessage);
          try {
            addConversationEvent({
              conversation_id: conversationId,
              kind: 'message_assistant',
              payload: { text: finalResponse, channel: 'text', supervisor: true },
              created_at_ms: assistantMessage.timestamp,
            });
          } catch {}
          if (channel === 'sms' && isSmsWindowOpen()) {
            const { smsUserNumber, smsTwilioNumber } = getNumbers();
            sendSms(finalResponse, smsTwilioNumber, smsUserNumber).catch((e) =>
              console.error("sendSms error", e)
            );
          } else if (channel === 'email') {
            const recipient = getReplyTo();
            if (recipient) {
              const replySubject = metadata.subject?.startsWith('Re: ') ? metadata.subject : `Re: ${metadata.subject}`;
              sendEmail(replySubject, finalResponse, recipient).catch((e) => console.error('sendEmail error', e));
            }
          }
          for (const ws of chatClients) {
            if (isOpen(ws))
              jsonSend(ws, {
                type: "chat.response",
                content: finalResponse,
                timestamp: Date.now(),
                supervisor: true,
                session_id: sessionId,
                conversation_id: conversationId,
              });
          }
          for (const ws of chatClients) {
            if (isOpen(ws)) jsonSend(ws, { type: "chat.done", request_id: requestId, timestamp: Date.now() });
          }
          session.currentRequest = undefined;
          // No logs emit; chat.response above includes meta to avoid duplication
          appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: assistantStepId_supervisor, timestamp: Date.now() });
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
        try {
          const { id: sessionId } = ensureSession();
          addConversationEvent({
            conversation_id: conversationId,
            kind: 'message_assistant',
            payload: { text: errorText, channel: 'text', supervisor: true },
            created_at_ms: assistantMessage.timestamp,
          });
        } catch {}
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, { type: "chat.response", content: errorText, timestamp: Date.now(), supervisor: true, session_id: sessionId, conversation_id: conversationId });
        }
        for (const ws of chatClients) {
          if (isOpen(ws)) jsonSend(ws, { type: "chat.done", request_id: requestId, timestamp: Date.now() });
        }
        session.currentRequest = undefined;
        // No logs emit; chat.response above includes meta
        appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: `step_error_${Date.now()}`, label: ThoughtFlowStepType.ToolError, payload: { error: err?.message || String(err) }, timestamp: Date.now() });
        // Do not auto-mark conversation completed on tool error; leave it open unless explicitly finalized
        return;
      }
    }
    // Fallback to assistant text output
    const assistantText = response.output_text || "(No text output)";
    const assistantStepId_fallback = `step_assistant_${Date.now()}`;
    appendEvent({ type: 'step.started', conversation_id: conversationId, step_id: assistantStepId_fallback, label: ThoughtFlowStepType.AssistantMessage, payload: { text: assistantText }, depends_on: llmStepId, timestamp: Date.now() });
    const assistantMessage = {
      type: "assistant" as const,
      content: assistantText,
      timestamp: Date.now(),
      channel: "text" as const,
      supervisor: false,
    };
    session.conversationHistory.push(assistantMessage);
    try {
      addConversationEvent({
        conversation_id: conversationId,
        kind: 'message_assistant',
        payload: { text: assistantText, channel: 'text', supervisor: false },
        created_at_ms: assistantMessage.timestamp,
      });
    } catch {}
    if (channel === 'sms' && isSmsWindowOpen()) {
      const { smsUserNumber, smsTwilioNumber } = getNumbers();
      sendSms(assistantText, smsTwilioNumber, smsUserNumber).catch((e) =>
        console.error("sendSms error", e)
      );
    } else if (channel === 'email') {
      const recipient = getReplyTo();
      if (recipient) {
        const replySubject = metadata.subject?.startsWith('Re: ') ? metadata.subject : `Re: ${metadata.subject}`;
        sendEmail(replySubject, assistantText, recipient).catch((e) => console.error('sendEmail error', e));
      }
    }
    for (const ws of chatClients) {
      if (isOpen(ws))
        jsonSend(ws, { type: "chat.response", content: assistantText, timestamp: Date.now(), session_id: sessionId, conversation_id: conversationId });
    }
    for (const ws of chatClients) {
      if (isOpen(ws)) jsonSend(ws, { type: "chat.done", request_id: requestId, timestamp: Date.now() });
    }
    session.currentRequest = undefined;
    // Do not emit a duplicate assistant message to logs; chat.response includes meta
    appendEvent({ type: 'step.completed', conversation_id: conversationId, step_id: assistantStepId_fallback, timestamp: Date.now() });
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
