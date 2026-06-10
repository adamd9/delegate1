import { registerTools } from "../registry";
import {
  copilotDispatchHandler,
  copilotGetResultHandler,
  copilotContinueHandler,
  copilotTaskStatusHandler,
} from "../handlers/copilotCli";
import { configService } from '../../config';

function wrapHandler(h: typeof copilotDispatchHandler) {
  return async (args: any) => {
    const out = await h.handler(args);
    if (typeof out === 'string') return out;
    try { return JSON.stringify(out); } catch { return String(out); }
  };
}

export function registerCopilotCliTools() {
  if (configService.get('BROWSER_ENABLED') !== 'true') {
    console.log('[copilot-cli] BROWSER_ENABLED not set, skipping copilot tool registration');
    return;
  }

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
