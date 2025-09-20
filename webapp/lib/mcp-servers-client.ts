import { getBackendUrl } from './get-backend-url';

export type McpServerItem = {
  id: string;
  name: string;
  url: string;
  type: 'streamable-http';
  description?: string;
  note?: string;
  enabled?: boolean;
  updated_at?: number;
};

export type McpServerInput = {
  name: string;
  url: string;
  type?: 'streamable-http';
  description?: string;
  note?: string;
  enabled?: boolean;
};

export type McpServerUpdate = {
  name?: string;
  url?: string;
  type?: 'streamable-http';
  description?: string | null;
  note?: string | null;
  enabled?: boolean;
};

export type McpReloadSummary = {
  serverCount: number;
  toolCount: number;
  attempted: number;
  failed: number;
};

function buildUrl(path: string) {
  return getBackendUrl() + path;
}

export async function fetchMcpServers(): Promise<McpServerItem[]> {
  const res = await fetch(buildUrl('/api/mcp-servers'), { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchMcpServers failed: ${res.status}`);
  const data = await res.json();
  return (data.items || []) as McpServerItem[];
}

export async function fetchMcpServer(id: string): Promise<McpServerItem> {
  const res = await fetch(buildUrl(`/api/mcp-servers/${encodeURIComponent(id)}`), { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchMcpServer failed: ${res.status}`);
  const data = await res.json();
  return data.item as McpServerItem;
}

export async function createMcpServer(payload: McpServerInput): Promise<McpServerItem> {
  const res = await fetch(buildUrl('/api/mcp-servers'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createMcpServer failed: ${res.status}`);
  const data = await res.json();
  return data.item as McpServerItem;
}

export async function updateMcpServer(id: string, payload: McpServerUpdate): Promise<McpServerItem> {
  const res = await fetch(buildUrl(`/api/mcp-servers/${encodeURIComponent(id)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`updateMcpServer failed: ${res.status}`);
  const data = await res.json();
  return data.item as McpServerItem;
}

export async function deleteMcpServer(id: string): Promise<void> {
  const res = await fetch(buildUrl(`/api/mcp-servers/${encodeURIComponent(id)}`), { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteMcpServer failed: ${res.status}`);
}

export async function reloadMcpServers(): Promise<McpReloadSummary> {
  const res = await fetch(buildUrl('/api/mcp-servers.reload'), { method: 'POST' });
  if (!res.ok) throw new Error(`reloadMcpServers failed: ${res.status}`);
  const data = await res.json();
  const summary = data.summary || {};
  return {
    serverCount: Number(summary.serverCount) || 0,
    toolCount: Number(summary.toolCount) || 0,
    attempted: Number(summary.attempted) || 0,
    failed: Number(summary.failed) || 0,
  };
}
