import { registerTools } from "../registry";
import {
  copilotDispatchHandler,
  copilotGetResultHandler,
  copilotContinueHandler,
  copilotTaskStatusHandler,
} from "../handlers/copilotCli";

function wrapHandler(h: typeof copilotDispatchHandler) {
  return async (args: any) => {
    const out = await h.handler(args);
    if (typeof out === 'string') return out;
    try { return JSON.stringify(out); } catch { return String(out); }
  };
}

export function registerCopilotCliTools() {
  // Always register the tools; handlers themselves report a clean error when
  // Copilot isn't yet configured. This avoids the "added the token but tools
  // are missing until I restart" footgun.
  const handlers = [
    copilotDispatchHandler,
    copilotGetResultHandler,
    copilotContinueHandler,
    copilotTaskStatusHandler,
  ];

  registerTools('copilot-cli', handlers.map(h => ({
    name: h.schema.name,
    description: h.schema.description || '',
    parameters: h.schema.parameters,
    origin: 'local',
    tags: ['copilot-cli', 'base-default'],
    handler: wrapHandler(h),
  })));

  console.log(`[copilot-cli] registered ${handlers.map(h => h.schema.name).join(', ')}`);
}
