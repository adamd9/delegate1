import { registerTools } from "../registry";
import { copilotDispatchHandler, copilotGetResultHandler } from "../handlers/copilotCli";

function wrapHandler(h: typeof copilotDispatchHandler) {
  return async (args: any) => {
    const out = await h.handler(args);
    if (typeof out === 'string') return out;
    try { return JSON.stringify(out); } catch { return String(out); }
  };
}

export function registerCopilotCliTools() {
  if (process.env.BROWSER_ENABLED !== 'true') {
    console.log('[copilot-cli] BROWSER_ENABLED not set, skipping copilot tool registration');
    return;
  }

  registerTools('copilot-cli', [
    {
      name: copilotDispatchHandler.schema.name,
      description: copilotDispatchHandler.schema.description || '',
      parameters: copilotDispatchHandler.schema.parameters,
      origin: 'local',
      tags: ['copilot-cli', 'base-default'],
      handler: wrapHandler(copilotDispatchHandler),
    },
    {
      name: copilotGetResultHandler.schema.name,
      description: copilotGetResultHandler.schema.description || '',
      parameters: copilotGetResultHandler.schema.parameters,
      origin: 'local',
      tags: ['copilot-cli', 'base-default'],
      handler: wrapHandler(copilotGetResultHandler),
    },
  ]);

  console.log('[copilot-cli] registered copilot_dispatch + copilot_status tools');
}
