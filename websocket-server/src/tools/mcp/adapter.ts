import { FunctionHandler } from '../../agentConfigs/types';
import { mcpClient, type DiscoveredTool, type RemoteServerConfig } from './client';
import { getMcpConfig } from '../../config/mcpConfig';
import { updateSupervisorMcpTools } from '../../agentConfigs/supervisorAgentConfig';

// Simple logger
const log = {
  info: (...a: any[]) => console.log('[mcpAdapter]', ...a),
  warn: (...a: any[]) => console.warn('[mcpAdapter]', ...a),
  error: (...a: any[]) => console.error('[mcpAdapter]', ...a),
};

let initialized = false;
let discoveryInFlight: Promise<void> | null = null;
const discoveredHandlers: FunctionHandler[] = [];
// map namespaced name -> { serverId, toolName }
const nameToRoute = new Map<string, { serverId: string; toolName: string }>();

function toSchema(tool: DiscoveredTool, serverName: string) {
  const name = `mcp.${serverName}.${tool.name}`;
  const inputSchema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {}, required: [] };
  const parameters = {
    type: 'object' as const,
    properties: inputSchema.properties || {},
    required: Array.isArray(inputSchema.required) ? inputSchema.required : [],
    additionalProperties: false,
  };
  return { name, type: 'function' as const, description: tool.description || `MCP tool ${tool.name} from ${serverName}` , parameters };
}

async function performDiscovery() {
  discoveredHandlers.length = 0;
  nameToRoute.clear();
  mcpClient.reset();

  try {
    await mcpClient.initialize();
  } catch (err: any) {
    log.error('Failed to initialize MCP client', err?.message || err);
    updateSupervisorMcpTools([]);
    return;
  }

  let servers: RemoteServerConfig[] = [];
  try {
    servers = await getMcpConfig();
  } catch (err: any) {
    log.warn('Unable to load MCP config', err?.message || err);
    updateSupervisorMcpTools([]);
    return;
  }

  if (!Array.isArray(servers) || servers.length === 0) {
    log.info('No MCP servers configured. Skipping discovery.');
    updateSupervisorMcpTools([]);
    return;
  }

  for (const s of servers) {
    const conn = await mcpClient.connectRemoteHttpServer(s);
    if (conn.status !== 'success') {
      log.error('Failed to connect to MCP server', s.name, conn.error);
      continue;
    }
    const serverId = conn.serverId;
    const tools = conn.tools || [];
    for (const t of tools) {
      const schema = toSchema(t, s.name);
      const handler: FunctionHandler = {
        schema,
        handler: async (args: any, addBreadcrumb?: (title: string, data?: any) => void) => {
          const start = Date.now();
          addBreadcrumb?.('MCP call start', { tool: schema.name });
          const res = await mcpClient.callTool(serverId, t.name, args || {});
          const ms = Date.now() - start;
          if (res.status === 'error') {
            addBreadcrumb?.('MCP call error', { tool: schema.name, ms, error: res.error });
            return JSON.stringify({ error: res.error });
          }
          addBreadcrumb?.('MCP call success', { tool: schema.name, ms });
          const out = res.result;
          if (typeof out === 'string') return out;
          try { return JSON.stringify(out); } catch { return String(out); }
        }
      };
      discoveredHandlers.push(handler);
      nameToRoute.set(schema.name, { serverId, toolName: t.name });
    }
  }

  updateSupervisorMcpTools([...discoveredHandlers]);
  log.info(`MCP discovery complete. ${discoveredHandlers.length} tool(s) registered.`);
}

export async function initMCPDiscovery(options?: { force?: boolean }) {
  if (discoveryInFlight) {
    return discoveryInFlight;
  }
  if (initialized && !options?.force) {
    return;
  }
  if (options?.force) {
    initialized = false;
  }
  discoveryInFlight = (async () => {
    try {
      await performDiscovery();
      initialized = true;
    } catch (e: any) {
      log.error('Discovery failed:', e?.message || e);
    } finally {
      discoveryInFlight = null;
    }
  })();
  await discoveryInFlight;
}

export function getDiscoveredMcpHandlers(): FunctionHandler[] {
  return discoveredHandlers;
}

export function getDiscoveredMcpFunctionSchemas(): any[] {
  return discoveredHandlers.map(h => h.schema);
}
