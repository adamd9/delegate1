import { registerTools, ToolOrigin } from "../registry";
import { getWeatherFunction } from "../handlers/weather";
import { sendCanvas } from "../handlers/canvas";
import { sendSmsTool } from "../handlers/sms";
import { getCurrentTimeFunction } from "../../agentConfigs/supervisorTools";
import { getNextResponseFromSupervisorFunction } from "../handlers/supervisor-escalation";

function wrap(name: string, description: string, parameters: any, origin: ToolOrigin, tags: string[], handler: (args: any) => Promise<any>) {
  return {
    name,
    description,
    parameters,
    origin,
    tags,
    handler: async (args: any) => {
      const out = await handler(args);
      if (typeof out === 'string') return out;
      try { return JSON.stringify(out); } catch { return String(out); }
    }
  };
}

export function registerLocalTools() {
  const providerId = 'local';
  const tools = [
    wrap(
      getWeatherFunction.schema.name,
      getWeatherFunction.schema.description,
      getWeatherFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => getWeatherFunction.handler(args)
    ),
    // Base agent escalation entrypoint to supervisor
    wrap(
      getNextResponseFromSupervisorFunction.schema.name,
      getNextResponseFromSupervisorFunction.schema.description,
      getNextResponseFromSupervisorFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => getNextResponseFromSupervisorFunction.handler(args)
    ),
    wrap(
      sendCanvas.schema.name,
      sendCanvas.schema.description,
      sendCanvas.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => sendCanvas.handler(args)
    ),
    wrap(
      sendSmsTool.schema.name,
      sendSmsTool.schema.description,
      sendSmsTool.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => sendSmsTool.handler(args)
    ),
    // Supervisor-local utility
    wrap(
      getCurrentTimeFunction.schema.name,
      getCurrentTimeFunction.schema.description || '',
      getCurrentTimeFunction.schema.parameters,
      'local',
      ['local', 'supervisor-allowed'],
      (args) => getCurrentTimeFunction.handler(args)
    ),
  ];
  registerTools(providerId, tools);
}
