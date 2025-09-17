import { WebSocket } from 'ws';
import { executeFunctionCall } from './functionCallExecutor';

export type OrchestratorMode = 'voice' | 'chat';

export interface RunSingleToolCallOptions {
  mode: OrchestratorMode;
  logsClients: Set<WebSocket>;
  confirm?: boolean; // reserved for future parity with chat flow
}

export interface ToolCallItem {
  name: string;
  arguments: string;
  call_id?: string;
}

/**
 * Unified wrapper to execute a single tool call, keeping the call.ts and chat.ts
 * paths consistent and centralized. Currently mirrors call.ts behavior (confirm=false).
 */
export async function runSingleToolCall(
  item: ToolCallItem,
  opts: RunSingleToolCallOptions
): Promise<any> {
  const { mode, logsClients } = opts;
  // Keep behavior identical to existing voice path: confirm = false
  const result = await executeFunctionCall(
    { name: item.name, arguments: item.arguments, call_id: item.call_id },
    { mode, logsClients, confirm: false }
  );
  return result;
}
