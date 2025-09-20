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
    const { type, url, name, description, note } = entry as any;
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
    if (description && typeof description === 'string') record.description = description;
    if (note && typeof note === 'string') record.note = note;
    result.push(record);
  }
  return result;
}

async function ensureConfigFile(): Promise<void> {
  try {
    await fs.mkdir(RUNTIME_DIR, { recursive: true });
  } catch {}
  try {
    await fs.access(CONFIG_FILE);
  } catch {
    await fs.writeFile(CONFIG_FILE, '[]\n', 'utf-8');
  }
}

export async function getMcpConfigText(): Promise<string> {
  await ensureConfigFile();
  return await fs.readFile(CONFIG_FILE, 'utf-8');
}

export async function getMcpConfig(): Promise<RemoteServerConfig[]> {
  const text = await getMcpConfigText();
  try {
    const parsed = JSON.parse(text);
    return validateServers(parsed);
  } catch (err: any) {
    throw new Error(err?.message || 'Invalid MCP config JSON');
  }
}

export async function writeMcpConfigText(text: string): Promise<RemoteServerConfig[]> {
  await ensureConfigFile();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    throw new Error(`Invalid JSON: ${err?.message || err}`);
  }
  const servers = validateServers(parsed);
  await fs.writeFile(CONFIG_FILE, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  return servers;
}

export const MCP_CONFIG_FILE_PATH = CONFIG_FILE;
