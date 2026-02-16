import { WebSocket } from "ws";
import { getAgent, FunctionHandler } from "../../agentConfigs";
import { getAdaptationTextById } from "../../adaptations";
import { ensureSession, appendEvent, ThoughtFlowStepType } from "../../observability/thoughtflow";
import { addConversationEvent } from "../../db/sqlite";
import { session } from "../../session/state";
import { jsonSend, isOpen } from "../../session/state";
import { executeBySanitizedName } from "../registry";

export type OrchestratorMode = "chat" | "voice";

export interface OrchestratorContext {
  mode: OrchestratorMode;
  logsClients: Set<WebSocket>;
  // For chat confirmation calls
  openaiClient?: any;
  previousResponseId?: string;
  confirm?: boolean; // default true for chat, false for voice
  announce?: boolean; // when true (default), print standard console logs for detection/execution/result
  // Optional: link this tool call to a previous step (e.g., prior tool or assistant_call)
  dependsOnStepId?: string;
}

export interface FunctionCallItem {
  name: string;
  arguments: any; // string or object
  call_id?: string;
}

function safeParseArgs(args: any): any {
  if (typeof args === "string") {
    try { return JSON.parse(args); } catch { return {}; }
  }
  return args || {};
}

function emitDelta(logsClients: Set<WebSocket>, name: string, data?: any, call_id?: string) {
  for (const ws of logsClients) {
    if (isOpen(ws)) jsonSend(ws, {
      type: "response.function_call_arguments.delta",
      name,
      arguments: JSON.stringify(data || {}),
      call_id: call_id || `supervisor_${Date.now()}`,
    });
  }
  // Persist a created breadcrumb into the transcript ledger (only if we have an active conversation)
  try {
    ensureSession();
    const convId = session.currentRequest ? `conv_${session.currentRequest.id}` : undefined;
    if (convId) {
      addConversationEvent({
        conversation_id: convId,
        kind: 'function_call_created',
        payload: { name, call_id, arguments: data || {} },
        created_at_ms: Date.now(),
      });
    }
  } catch {}
}

function emitDone(logsClients: Set<WebSocket>, name: string, originalArgs: any, call_id?: string, result?: any) {
  for (const ws of logsClients) {
    if (isOpen(ws)) jsonSend(ws, {
      type: "response.function_call_arguments.done",
      name,
      arguments: typeof originalArgs === 'string' ? originalArgs : JSON.stringify(originalArgs || {}),
      call_id,
      status: "completed",
      ...(result !== undefined ? { result: typeof result === 'string' ? result : JSON.stringify(result) } : {}),
    });
  }
  // Persist a completed breadcrumb into the transcript ledger (only if we have an active conversation)
  try {
    ensureSession();
    const convId = session.currentRequest ? `conv_${session.currentRequest.id}` : undefined;
    if (convId) {
      addConversationEvent({
        conversation_id: convId,
        kind: 'function_call_completed',
        payload: { name, call_id, arguments: originalArgs, result },
        created_at_ms: Date.now(),
      });
    }
  } catch {}
}

export async function executeFunctionCall(call: FunctionCallItem, ctx: OrchestratorContext): Promise<any> {
  const allFns = getAgent('base').tools as FunctionHandler[];
  const handler = allFns.find((f: FunctionHandler) => f.schema.name === call.name);
  // If not found in static base agent tools, try the centralized registry (handles MCP tools etc.)
  const useRegistry = !handler;
  let parsed = safeParseArgs(call.arguments);
  if (ctx.announce !== false) {
    console.log(`🔧 Function call detected: ${call.name}`);
    console.log(`🧠 Executing ${call.name} with args:`, JSON.stringify(parsed));
  }
  // ThoughtFlow: In chat mode, record orchestrated tool calls as proper steps
  let tfStepId: string | undefined;
  let tfConversationId: string | undefined;
  // Only instrument when an explicit dependency is provided to avoid
  // duplicating the first tool call (which chat.ts already records).
  if (ctx.mode === 'chat' && ctx.dependsOnStepId) {
    try {
      ensureSession();
      const req = session.currentRequest;
      if (req) {
        tfConversationId = `conv_${req.id}`;
        tfStepId = `step_tool_${call.call_id || Date.now()}`;
        appendEvent({
          type: 'step.started',
          conversation_id: tfConversationId,
          step_id: tfStepId,
          label: ThoughtFlowStepType.ToolCall,
          payload: { name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {}) },
          ...(ctx.dependsOnStepId ? { depends_on: ctx.dependsOnStepId } : {}),
          timestamp: Date.now(),
        });
      }
    } catch {}
  }
  // Provide a tool_call step id to downstream handlers so they can declare proper
  // dependencies (e.g., supervisor assistant_call depends_on tool_call). If we
  // didn't create a step here (because chat.ts already did), derive it from call_id.
  const effectiveToolStepId = tfStepId || (call.call_id ? `step_tool_${call.call_id}` : undefined);
  if (effectiveToolStepId) {
    parsed = { ...parsed, __dependsOnStepId: effectiveToolStepId };
  }
  // Emit delta using the model-provided call_id to avoid duplicate-looking entries
  emitDelta(ctx.logsClients, call.name, parsed, call.call_id);
  try {
    let result: any;
    if (useRegistry) {
      // Execute via centralized registry (MCP tools, etc.)
      result = await executeBySanitizedName(call.name, parsed);
    } else {
      result = await (handler as any).handler(parsed, (title: string, data?: any) => {
        const name = title.includes("function call:") ? title.split("function call: ")[1] : title;
        // Breadcrumbs from inside handlers don't map to the original call_id; generate ephemeral ids
        emitDelta(ctx.logsClients, name, data);
      });
    }
    emitDone(ctx.logsClients, call.name, call.arguments, call.call_id, result);
    // ThoughtFlow: complete the tool call step in chat mode
    if (ctx.mode === 'chat' && ctx.dependsOnStepId && tfConversationId && tfStepId) {
      try {
        appendEvent({
          type: 'step.completed',
          conversation_id: tfConversationId,
          step_id: tfStepId,
          payload: { output: result, meta: { status: 'ok' } },
          timestamp: Date.now(),
        });
      } catch {}
    }
    if (ctx.announce !== false) {
      const len = typeof result === 'string' ? (result as string).length : JSON.stringify(result || {}).length;
      console.log(`✅ Function result received (${len} chars)`);
    }
    return result;
  } catch (e: any) {
    const errMsg = e?.message || "handler error";
    emitDone(ctx.logsClients, call.name, call.arguments, call.call_id, { error: errMsg });
    if (ctx.mode === 'chat' && tfConversationId && tfStepId) {
      try {
        appendEvent({
          type: 'step.completed',
          conversation_id: tfConversationId,
          step_id: tfStepId,
          payload: { error: errMsg },
          timestamp: Date.now(),
        });
      } catch {}
    }
    // Do not throw; return structured error so upstream can continue gracefully
    return { error: errMsg };
  }
}

export async function executeFunctionCalls(
  calls: FunctionCallItem[],
  ctx: OrchestratorContext
): Promise<{ handled: boolean; confirmText?: string; confirmResponseId?: string; executedCall?: FunctionCallItem }>
{
  if (!calls || calls.length === 0) return { handled: false };
  // Prefer canvas if present; else first call
  const canvas = calls.find(c => c.name === 'send_canvas');
  const next = canvas || calls[0];
  const result = await executeFunctionCall(next, ctx);

  // Optional chat confirmation step
  const shouldConfirm = ctx.confirm ?? (ctx.mode === 'chat');
  if (shouldConfirm && ctx.openaiClient && ctx.previousResponseId && next.call_id) {
    // Inject prompt adaptations for confirmation stage via a dedicated identifier
    const confirmAdaptId = 'adn.prompt.core.toolConfirm';
    const confirmAdapt = await getAdaptationTextById(confirmAdaptId);
    const confirmAdaptText = (confirmAdapt?.text || '').trim();
    // ThoughtFlow: emit a prompt.adaptations step for confirmation stage in chat mode
    if (ctx.mode === 'chat') {
      try {
        ensureSession();
        const req = session.currentRequest;
        if (req) {
          const convId = `conv_${req.id}`;
          const adaptStepId = `snp_adapt_confirm_${next.call_id || Date.now()}`;
          appendEvent({
            type: 'step.started',
            conversation_id: convId,
            step_id: adaptStepId,
            label: 'prompt.adaptations',
            ...(ctx.dependsOnStepId ? { depends_on: ctx.dependsOnStepId } : {}),
            payload: {
              adaptation_id: confirmAdaptId,
              content_preview: confirmAdaptText.slice(0, 200),
              content_length: confirmAdaptText.length,
              scope: { agent: 'base', channel: req.channel },
              modifiable: true,
              version: confirmAdapt?.version || 0,
            },
            timestamp: Date.now(),
          });
          appendEvent({ type: 'step.completed', conversation_id: convId, step_id: adaptStepId, timestamp: Date.now() });
        }
      } catch {}
    }
    const confirmBody: any = {
      model: getAgent('base').textModel || getAgent('base').model || 'gpt-5-mini',
      reasoning: { effort: 'minimal' as const },
      previous_response_id: ctx.previousResponseId,
      input: [
        { type: 'function_call', call_id: next.call_id, name: next.name, arguments: typeof next.arguments === 'string' ? next.arguments : JSON.stringify(next.arguments || {}) },
        { type: 'function_call_output', call_id: next.call_id, output: typeof result === 'string' ? result : JSON.stringify(result) },
      ],
      instructions: (() => {
        const baseInstr = next.name === 'send_canvas'
          ? 'Provide a concise plain-text confirmation (1-2 sentences) that the canvas has been sent, optionally summarizing what was included.'
          : 'Provide a concise plain-text confirmation (1-2 sentences) that the requested action has been performed successfully.';
        return [confirmAdaptText, baseInstr].filter(Boolean).join('\n');
      })(),
    };
    const confirmResponse = await ctx.openaiClient.responses.create(confirmBody);
    const confirmText = confirmResponse.output_text || 'Done.';
    return { handled: true, confirmText, confirmResponseId: confirmResponse.id, executedCall: next };
  }

  return { handled: true, executedCall: next };
}
