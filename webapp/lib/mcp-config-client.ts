import { getBackendUrl } from './get-backend-url';

export type McpServerConfig = {
  type: 'streamable-http';
  url: string;
  name: string;
  description?: string;
  note?: string;
};

export async function fetchMcpConfig() {
  const res = await fetch(`${getBackendUrl()}/api/mcp/config`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load MCP config: ${res.status}`);
  }
  const data = await res.json();
  return {
    text: String(data.text ?? ''),
    servers: Array.isArray(data.servers) ? (data.servers as McpServerConfig[]) : [],
  };
}

export async function updateMcpConfig(text: string) {
  const res = await fetch(`${getBackendUrl()}/api/mcp/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    let message = `Failed to update MCP config: ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {}
    throw new Error(message);
  }
  const data = await res.json();
  return {
    status: data.status as string,
    servers: Array.isArray(data.servers) ? (data.servers as McpServerConfig[]) : [],
  };
}
