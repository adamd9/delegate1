import { registerTools } from "../registry";
import { getDiscoveredMcpHandlers } from "../../agentConfigs/mcpAdapter";

export function registerMcpTools() {
  const providerId = 'mcp';
  const handlers = getDiscoveredMcpHandlers();
  const tools = handlers.map((h) => ({
    name: h.schema.name,
    description: h.schema.description || '',
    parameters: h.schema.parameters,
    origin: 'mcp' as const,
    tags: ['mcp', 'supervisor-allowed'],
    handler: async (args: any) => {
      const out = await h.handler(args);
      if (typeof out === 'string') return out;
      try { return JSON.stringify(out); } catch { return String(out); }
    }
  }));
  if (tools.length) registerTools(providerId, tools);
}
