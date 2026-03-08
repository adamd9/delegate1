import type { Client as MCPClientSDK } from '@modelcontextprotocol/sdk/client/index.js';
import type { StreamableHTTPClientTransport as HTTPTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Lightweight logger shim
const log = {
  debug: (...args: any[]) => console.debug('[mcpClient]', ...args),
  error: (...args: any[]) => console.error('[mcpClient]', ...args),
};


export type RemoteServerConfig = {
  type: 'streamable-http';
  url: string;
  name: string;
  headers?: Record<string, string>; // optional custom headers (e.g., Authorization)
};

export type DiscoveredTool = {
  name: string;
  description?: string;
  inputSchema?: any;
  outputSchema?: any;
};

type ServerRecord = {
  id: string;
  name: string;
  url: string;
  description?: string;
  serverInfo?: any;
  type: 'http-sdk';
  sdkClient: MCPClientSDK;
  tools: DiscoveredTool[];
};

export class MCPClient {
  private servers = new Map<string, ServerRecord>();
  private toolToServer = new Map<string, string>(); // toolName -> serverId
  private initialized = false;

  async initialize() {
    if (this.initialized) return;
    log.debug('Initializing MCP client');
    this.initialized = true;
  }

  reset() {
    for (const server of this.servers.values()) {
      try {
        const maybeClose = (server.sdkClient as any)?.close;
        if (typeof maybeClose === 'function') {
          maybeClose.call(server.sdkClient);
        }
      } catch (err) {
        log.error('Error closing MCP client connection', err);
      }
    }
    this.servers.clear();
    this.toolToServer.clear();
    this.initialized = false;
  }

  getServer(serverId: string) {
    return this.servers.get(serverId);
  }

  async connectRemoteHttpServer(serverConfig: RemoteServerConfig): Promise<{ status: 'success'; serverId: string; tools: DiscoveredTool[] } | { status: 'error'; error: string }> {
    try {
      if (!serverConfig?.url || !serverConfig?.name || serverConfig.type !== 'streamable-http') {
        return { status: 'error', error: 'Invalid remote server configuration' };
      }

      // Dynamic import to avoid forcing SDK load if unused
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js') as any;
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js') as any;

      const client: MCPClientSDK = new Client({ name: `delegate1-mcp-${serverConfig.name}`, version: '1.0.0' } as any);
      const transportOptions: any = {};
      if (serverConfig.headers && typeof serverConfig.headers === 'object') {
        transportOptions.requestInit = { headers: serverConfig.headers };
      }
      const transport: HTTPTransport = new (StreamableHTTPClientTransport as any)(new URL(serverConfig.url), transportOptions) as any;

      log.debug(`Connecting to MCP server ${serverConfig.name} at ${serverConfig.url}`);
      await (client as any).connect(transport);

      // Read server-reported info (name/version/etc.) from initialize result
      let serverInfo: any = undefined;
      try {
        if (typeof (client as any).getServerVersion === 'function') {
          serverInfo = (client as any).getServerVersion();
        }
      } catch {}

      const serverId = `remote_http_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      // list tools
      const toolListResp: any = await (client as any).listTools();
      const tools: DiscoveredTool[] = Array.isArray(toolListResp?.tools) ? toolListResp.tools : [];
      log.debug(`Discovered ${tools.length} tools on ${serverConfig.name}`);

      const record: ServerRecord = {
        id: serverId,
        name: serverConfig.name,
        url: serverConfig.url,
        description: (serverInfo && (serverInfo.name || serverInfo.productName)) || undefined,
        serverInfo,
        type: 'http-sdk',
        sdkClient: client,
        tools,
      };
      this.servers.set(serverId, record);
      for (const t of tools) this.toolToServer.set(t.name, serverId);

      return { status: 'success', serverId, tools };
    } catch (err: any) {
      log.error('Failed connecting remote HTTP MCP server', err?.message || err);
      return { status: 'error', error: err?.message || 'Unknown MCP connect error' };
    }
  }

  async callTool(serverId: string, toolName: string, parameters: any): Promise<{ status: 'success'; result: any } | { status: 'error'; error: string }> {
    const server = this.servers.get(serverId);
    if (!server) return { status: 'error', error: `Server not found: ${serverId}` };

    try {
      const argsObj = typeof parameters === 'string' ? JSON.parse(parameters) : parameters || {};
      const resp: any = await (server.sdkClient as any).callTool({ name: toolName, arguments: argsObj });

      // Streaming async iterator
      if (resp && typeof resp[Symbol.asyncIterator] === 'function') {
        let accumulated = '';
        for await (const chunk of resp) {
          if (chunk?.error) return { status: 'error', error: chunk.error?.message || 'Stream error' };
          if (typeof chunk?.output === 'string') accumulated += chunk.output;
          if (chunk?.isDone) break;
        }
        return { status: 'success', result: accumulated };
      }

      // Non-streaming shapes: prefer content[0].text, else output, else raw
      let finalResult: any = undefined;
      if (resp?.content && Array.isArray(resp.content) && resp.content[0]?.type === 'text') {
        const t = resp.content[0].text;
        try { finalResult = JSON.parse(t); } catch { finalResult = t; }
      } else if (resp?.output !== undefined) {
        finalResult = resp.output;
      } else {
        finalResult = resp;
      }
      return { status: 'success', result: finalResult };
    } catch (err: any) {
      log.error('Error calling MCP tool', { serverId, toolName, error: err?.message });
      return { status: 'error', error: err?.message || 'Unknown MCP call error' };
    }
  }
}

export const mcpClient = new MCPClient();
