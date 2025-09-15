import { WebSocket } from "ws";
import { getAgent, FunctionHandler } from "../../agentConfigs";
import { ensureSession } from "../../observability/thoughtflow";
import { addConversationEvent } from "../../db/sqlite";
import { session } from "../../session/state";
import { jsonSend, isOpen } from "../../session/state";

export type OrchestratorMode = "chat" | "voice";

export interface OrchestratorContext {
  mode: OrchestratorMode;
  logsClients: Set<WebSocket>;
  // For chat confirmation calls
  openaiClient?: any;
  previousResponseId?: string;
  confirm?: boolean; // default true for chat, false for voice
  announce?: boolean; // when true (default), print standard console logs for detection/execution/result
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
    const runId = session.currentRequest ? `run_${session.currentRequest.id}` : undefined;
    if (runId) {
      addConversationEvent({
        conversation_id: runId,
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
    const runId = session.currentRequest ? `run_${session.currentRequest.id}` : undefined;
    if (runId) {
      addConversationEvent({
        conversation_id: runId,
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
  if (!handler) throw new Error(`No handler found for function: ${call.name}`);
  const parsed = safeParseArgs(call.arguments);
  if (ctx.announce !== false) {
    console.log(`🔧 Function call detected: ${call.name}`);
    console.log(`🧠 Executing ${call.name} with args:`, JSON.stringify(parsed));
  }
  // Emit delta using the model-provided call_id to avoid duplicate-looking entries
  emitDelta(ctx.logsClients, call.name, parsed, call.call_id);
  try {
    const result = await (handler as any).handler(parsed, (title: string, data?: any) => {
      const name = title.includes("function call:") ? title.split("function call: ")[1] : title;
      // Breadcrumbs from inside handlers don't map to the original call_id; generate ephemeral ids
      emitDelta(ctx.logsClients, name, data);
    });
    emitDone(ctx.logsClients, call.name, call.arguments, call.call_id, result);
    if (ctx.announce !== false) {
      const len = typeof result === 'string' ? (result as string).length : JSON.stringify(result || {}).length;
      console.log(`✅ Function result received (${len} chars)`);
    }
    return result;
  } catch (e: any) {
    const errMsg = e?.message || "handler error";
    emitDone(ctx.logsClients, call.name, call.arguments, call.call_id, { error: errMsg });
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
    const confirmBody: any = {
      model: getAgent('base').textModel || getAgent('base').model || 'gpt-5-mini',
      reasoning: { effort: 'minimal' as const },
      previous_response_id: ctx.previousResponseId,
      input: [
        { type: 'function_call', call_id: next.call_id, name: next.name, arguments: typeof next.arguments === 'string' ? next.arguments : JSON.stringify(next.arguments || {}) },
        { type: 'function_call_output', call_id: next.call_id, output: typeof result === 'string' ? result : JSON.stringify(result) },
      ],
      instructions: next.name === 'send_canvas'
        ? 'Provide a concise plain-text confirmation (1-2 sentences) that the canvas has been sent, optionally summarizing what was included.'
        : 'Provide a concise plain-text confirmation (1-2 sentences) that the requested action has been performed successfully.',
    };
    const confirmResponse = await ctx.openaiClient.responses.create(confirmBody);
    const confirmText = confirmResponse.output_text || 'Done.';
    return { handled: true, confirmText, confirmResponseId: confirmResponse.id, executedCall: next };
  }

  return { handled: true, executedCall: next };
}
