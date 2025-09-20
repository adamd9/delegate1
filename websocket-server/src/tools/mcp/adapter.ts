import { FunctionHandler } from '../../agentConfigs/types';
import { mcpClient, type DiscoveredTool, type RemoteServerConfig } from './client';
import { listMcpServers, type McpServerRecord } from '../../mcpServers';

// Simple logger
const log = {
  info: (...a: any[]) => console.log('[mcpAdapter]', ...a),
  warn: (...a: any[]) => console.warn('[mcpAdapter]', ...a),
  error: (...a: any[]) => console.error('[mcpAdapter]', ...a),
};

let discoveredHandlers: FunctionHandler[] = [];
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

async function performDiscovery(): Promise<{ serverCount: number; toolCount: number; attempted: number; failed: number }> {
  discoveredHandlers = [];
  nameToRoute.clear();

  await mcpClient.reset();
  await mcpClient.initialize();

  let records: McpServerRecord[] = [];
  try {
    records = await listMcpServers();
  } catch (err: any) {
    log.error('Unable to read MCP server definitions', err?.message || err);
    return { serverCount: 0, toolCount: 0, attempted: 0, failed: 0 };
  }

  const active = records.filter((r) => r.enabled !== false);
  if (active.length === 0) {
    log.info('No MCP servers configured. Skipping discovery.');
    return { serverCount: 0, toolCount: 0, attempted: 0, failed: 0 };
  }

  let serverCount = 0;
  let toolCount = 0;
  let failed = 0;

  for (const record of active) {
    const config: RemoteServerConfig = {
      type: record.type || 'streamable-http',
      url: record.url,
      name: record.name,
      description: record.description,
      note: record.note,
    };

    if (config.type !== 'streamable-http') {
      log.warn('Skipping unsupported MCP server type', record.type, 'for', record.id);
      failed++;
      continue;
    }

    const conn = await mcpClient.connectRemoteHttpServer(config);
    if (conn.status !== 'success') {
      log.error('Failed to connect to MCP server', record.name, conn.error);
      failed++;
      continue;
    }

    serverCount++;
    const serverId = conn.serverId;
    const tools = conn.tools || [];
    toolCount += tools.length;

    for (const t of tools) {
      const schema = toSchema(t, record.name);
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

  log.info(`MCP discovery complete. ${discoveredHandlers.length} tool(s) registered from ${serverCount} server(s).`);
  return { serverCount, toolCount, attempted: active.length, failed };
}

export async function initMCPDiscovery(): Promise<{ serverCount: number; toolCount: number; attempted: number; failed: number }> {
  try {
    return await performDiscovery();
  } catch (e: any) {
    log.error('Discovery failed:', e?.message || e);
    discoveredHandlers = [];
    nameToRoute.clear();
    return { serverCount: 0, toolCount: 0, attempted: 0, failed: 0 };
  }
}

export function getDiscoveredMcpHandlers(): FunctionHandler[] {
  return discoveredHandlers;
}

export function getDiscoveredMcpFunctionSchemas(): any[] {
  return discoveredHandlers.map(h => h.schema);
}
