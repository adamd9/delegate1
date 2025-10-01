import type { Client as MCPClientSDK } from '@modelcontextprotocol/sdk/client/index.js';
import type { StreamableHTTPClientTransport as HTTPTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Lightweight logger shim
const log = {
  debug: (...args: any[]) => console.debug('[mcpClient]', ...args),
  error: (...args: any[]) => console.error('[mcpClient]', ...args),
  http: (...args: any[]) => console.log('[mcpClient:HTTP]', ...args),
};

// Mask sensitive header values for safe logging
function maskHeaders(headers?: Record<string, string> | Headers): Record<string, string> | undefined {
  if (!headers) return undefined;
  const masked: Record<string, string> = {};
  const entries = headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers);
  for (const [k, v] of entries) {
    if (typeof v !== 'string') { masked[k] = String(v); continue; }
    const lower = k.toLowerCase();
    if (/(key|token|secret|authorization)/.test(lower)) {
      const shown = v.length > 8 ? `${v.slice(0,4)}…${v.slice(-4)}` : '***';
      masked[k] = `[masked:${shown}]`;
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

// Debug fetch wrapper to log all HTTP requests
function createDebugFetch(serverName: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method || 'GET';
    const headers = init?.headers;
    
    log.http('→ REQUEST', {
      server: serverName,
      method,
      url,
      headers: maskHeaders(headers as any),
      bodyPreview: init?.body ? String(init.body).slice(0, 200) + (String(init.body).length > 200 ? '...' : '') : undefined,
    });
    
    try {
      const response = await fetch(input, init);
      
      log.http('← RESPONSE', {
        server: serverName,
        status: response.status,
        statusText: response.statusText,
        headers: maskHeaders(response.headers),
        url,
      });
      
      return response;
    } catch (error: any) {
      log.http('✗ REQUEST FAILED', {
        server: serverName,
        url,
        error: error?.message || String(error),
      });
      throw error;
    }
  };
}

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
      const transportOptions: any = {
        fetch: createDebugFetch(serverConfig.name),
      };
      if (serverConfig.headers && typeof serverConfig.headers === 'object') {
        transportOptions.requestInit = { headers: serverConfig.headers };
      }
      // Targeted debug: log the exact URL/name and masked headers before connecting
      log.debug('Connecting (HTTP) to MCP server', {
        name: serverConfig.name,
        url: serverConfig.url,
        headers: maskHeaders(serverConfig.headers),
      });
      const transport: HTTPTransport = new (StreamableHTTPClientTransport as any)(new URL(serverConfig.url), transportOptions) as any;

      log.debug(`Initiating MCP connection to ${serverConfig.name}`);
      await (client as any).connect(transport);
      log.debug(`✓ Successfully connected to ${serverConfig.name}`);

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
      log.debug(`Calling tool ${toolName} on server ${server.name}`, { arguments: argsObj });
      const resp: any = await (server.sdkClient as any).callTool({ name: toolName, arguments: argsObj });

      // Streaming async iterator
      if (resp && typeof resp[Symbol.asyncIterator] === 'function') {
        let accumulated = '';
        for await (const chunk of resp) {
          if (chunk?.error) {
            log.error(`Tool ${toolName} returned error`, chunk.error);
            return { status: 'error', error: chunk.error?.message || 'Stream error' };
          }
          if (typeof chunk?.output === 'string') accumulated += chunk.output;
          if (chunk?.isDone) break;
        }
        log.debug(`Tool ${toolName} completed (streaming)`, { resultLength: accumulated.length });
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
      log.debug(`Tool ${toolName} completed`, { 
        resultType: typeof finalResult,
        resultPreview: typeof finalResult === 'string' ? finalResult.slice(0, 100) : JSON.stringify(finalResult).slice(0, 100)
      });
      return { status: 'success', result: finalResult };
    } catch (err: any) {
      log.error('Error calling MCP tool', { serverId, toolName, error: err?.message });
      return { status: 'error', error: err?.message || 'Unknown MCP call error' };
    }
  }
}

export const mcpClient = new MCPClient();
