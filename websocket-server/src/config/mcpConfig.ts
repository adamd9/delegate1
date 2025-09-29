import { promises as fs } from 'fs';
import { join } from 'path';
import { RemoteServerConfig } from '../tools/mcp/client';

const RUNTIME_DIR = join(__dirname, '..', '..', 'runtime-data');
const CONFIG_FILE = join(RUNTIME_DIR, 'mcp-servers.json');

function validateServers(value: unknown): RemoteServerConfig[] {
  if (!Array.isArray(value)) {
    throw new Error('MCP config must be a JSON array');
  }
  const result: RemoteServerConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Each MCP server entry must be an object');
    }
    const { type, url, name, headers } = entry as any;
    if (type !== 'streamable-http') {
      throw new Error('Unsupported MCP server type');
    }
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('MCP server url is required');
    }
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('MCP server name is required');
    }
    const record: RemoteServerConfig = {
      type: 'streamable-http',
      url: url.trim(),
      name: name.trim(),
    };
    // description/note in config are ignored; we prefer server-reported metadata post-initialize
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      // Only accept string:string pairs; coerce others to string where possible
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (typeof k !== 'string') continue;
        if (typeof v === 'string') clean[k] = v;
        else if (v != null) clean[k] = String(v);
      }
      if (Object.keys(clean).length > 0) record.headers = clean;
    }
    result.push(record);
  }
  return result;
}

async function ensureConfigFile(): Promise<void> {
  console.log('[mcpConfig] ensureConfigFile start', {
    RUNTIME_DIR,
    CONFIG_FILE,
    RUNTIME_DATA_DIR: process.env.RUNTIME_DATA_DIR || undefined,
  });
  try {
    await fs.mkdir(RUNTIME_DIR, { recursive: true });
    console.log('[mcpConfig] ensured runtime dir exists');
  } catch (e: any) {
    console.warn('[mcpConfig] mkdir failed', e?.code, e?.message);
  }
  try {
    await fs.access(CONFIG_FILE);
    console.log('[mcpConfig] config file exists');
  } catch (e: any) {
    console.log('[mcpConfig] config file missing, attempting to create with []');
    try {
      await fs.writeFile(CONFIG_FILE, '[]\n', 'utf-8');
      console.log('[mcpConfig] wrote default empty config');
    } catch (w: any) {
      console.error('[mcpConfig] failed to write default config', w?.code, w?.message);
      throw w;
    }
  }
}

export async function getMcpConfigText(): Promise<string> {
  await ensureConfigFile();
  console.log('[mcpConfig] reading config text from', CONFIG_FILE);
  const txt = await fs.readFile(CONFIG_FILE, 'utf-8');
  console.log('[mcpConfig] read config bytes', { length: txt?.length ?? 0 });
  return txt;
}

export async function getMcpConfig(): Promise<RemoteServerConfig[]> {
  const text = await getMcpConfigText();
  try {
    const parsed = JSON.parse(text);
    const servers = validateServers(parsed);
    console.log('[mcpConfig] parsed config', { servers: servers.length });
    return servers;
  } catch (err: any) {
    console.error('[mcpConfig] failed to parse/validate config', {
      path: CONFIG_FILE,
      length: text?.length ?? 0,
      snippet: String(text).slice(0, 200),
    });
    throw new Error(err?.message || 'Invalid MCP config JSON');
  }
}

export async function writeMcpConfigText(text: string): Promise<RemoteServerConfig[]> {
  await ensureConfigFile();
  console.log('[mcpConfig] write requested', { path: CONFIG_FILE, length: text?.length ?? 0 });
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    console.error('[mcpConfig] write invalid JSON', err?.message || err);
    throw new Error(`Invalid JSON: ${err?.message || err}`);
  }
  const servers = validateServers(parsed);
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    console.log('[mcpConfig] write success', { servers: servers.length });
  } catch (err: any) {
    console.error('[mcpConfig] write failed', { path: CONFIG_FILE, code: err?.code, message: err?.message });
    throw err;
  }
  return servers;
}

export const MCP_CONFIG_FILE_PATH = CONFIG_FILE;
