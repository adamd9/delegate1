import { promises as fs } from 'fs';
import path from 'path';
import type { RemoteServerConfig } from './tools/mcp/client';

export interface McpServerRecord extends RemoteServerConfig {
  id: string;
  enabled?: boolean;
  updated_at?: number;
}

export type McpServerInput = {
  name: string;
  url: string;
  type?: RemoteServerConfig['type'];
  description?: string;
  note?: string;
  enabled?: boolean;
};

export type McpServerUpdate = {
  name?: string;
  url?: string;
  type?: RemoteServerConfig['type'];
  description?: string | null;
  note?: string | null;
  enabled?: boolean;
};

const RUNTIME_DIR = path.join(__dirname, '..', 'runtime-data');
const RUNTIME_FILE = path.join(RUNTIME_DIR, 'mcp.servers.json');
const LEGACY_FILE = path.join(__dirname, '..', 'config', 'mcp.json');

let cached: McpServerRecord[] | null = null;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function ensureBoolean(value: any): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

function sanitizeString(value: any): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueIdFromBase(base: string, existing: Set<string>): string {
  const slug = slugify(base) || 'server';
  let candidate = slug;
  let counter = 1;
  while (existing.has(candidate)) {
    counter += 1;
    candidate = `${slug}-${counter}`;
  }
  existing.add(candidate);
  return candidate;
}

function ensureUniqueId(rawId: any, existing: Set<string>, fallbackBase: string): string {
  const candidate = sanitizeString(rawId);
  if (!candidate) return uniqueIdFromBase(fallbackBase, existing);
  if (!existing.has(candidate)) {
    existing.add(candidate);
    return candidate;
  }
  let counter = 2;
  let next = `${candidate}-${counter}`;
  while (existing.has(next)) {
    counter += 1;
    next = `${candidate}-${counter}`;
  }
  existing.add(next);
  return next;
}

function normalizeRecords(list: any[], assignTimestampIfMissing: boolean): McpServerRecord[] {
  const existing = new Set<string>();
  const normalized: McpServerRecord[] = [];
  list.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const name = sanitizeString(raw.name);
    const url = sanitizeString(raw.url);
    if (!name || !url) return;
    const fallbackBase = `${name}-${index + 1}`;
    const id = ensureUniqueId(raw.id, existing, fallbackBase);
    const type: RemoteServerConfig['type'] = raw.type === 'streamable-http' ? 'streamable-http' : 'streamable-http';
    const description = sanitizeString(raw.description);
    const note = sanitizeString(raw.note);
    const enabled = ensureBoolean(raw.enabled);
    const rawUpdated = raw.updated_at;
    const updated_at = typeof rawUpdated === 'number' ? rawUpdated : (assignTimestampIfMissing ? Date.now() : undefined);
    normalized.push({
      id,
      type,
      name,
      url,
      description,
      note,
      enabled,
      updated_at,
    });
  });
  return normalized;
}

async function readRuntimeFile(): Promise<McpServerRecord[] | null> {
  try {
    const text = await fs.readFile(RUNTIME_FILE, 'utf-8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return normalizeRecords(parsed, false);
  } catch {
    return null;
  }
}

async function loadLegacyFile(): Promise<McpServerRecord[] | null> {
  try {
    const text = await fs.readFile(LEGACY_FILE, 'utf-8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return normalizeRecords(parsed, true);
  } catch {
    return null;
  }
}

async function ensureCache(): Promise<McpServerRecord[]> {
  if (cached) return cached;
  await fs.mkdir(RUNTIME_DIR, { recursive: true });

  const existing = await readRuntimeFile();
  if (existing) {
    cached = existing;
    return cached;
  }

  const legacy = await loadLegacyFile();
  if (legacy) {
    await writeRecords(legacy);
    return cached ?? legacy;
  }

  await writeRecords([]);
  return cached ?? [];
}

async function writeRecords(records: McpServerRecord[]) {
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  await fs.writeFile(RUNTIME_FILE, JSON.stringify(records, null, 2), 'utf-8');
  cached = records.map((r) => ({ ...r }));
}

export async function listMcpServers(): Promise<McpServerRecord[]> {
  const records = await ensureCache();
  return records
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((record) => ({ ...record }));
}

export async function getMcpServer(id: string): Promise<McpServerRecord | undefined> {
  const records = await ensureCache();
  const found = records.find((r) => r.id === id);
  return found ? { ...found } : undefined;
}

export async function createMcpServer(input: McpServerInput): Promise<McpServerRecord> {
  const name = sanitizeString(input.name);
  const url = sanitizeString(input.url);
  if (!name) throw new Error('Name is required');
  if (!url) throw new Error('URL is required');
  const type: RemoteServerConfig['type'] = input.type === 'streamable-http' || !input.type ? 'streamable-http' : input.type;
  if (type !== 'streamable-http') throw new Error('Unsupported MCP server type');

  const records = await ensureCache();
  const existingIds = new Set(records.map((r) => r.id));
  const id = uniqueIdFromBase(name, existingIds);
  const record: McpServerRecord = {
    id,
    type,
    name,
    url,
    description: sanitizeString(input.description),
    note: sanitizeString(input.note),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
    updated_at: Date.now(),
  };
  const next = [...records, record];
  await writeRecords(next);
  return { ...record };
}

export async function updateMcpServer(id: string, updates: McpServerUpdate): Promise<McpServerRecord | undefined> {
  const records = await ensureCache();
  const index = records.findIndex((r) => r.id === id);
  if (index === -1) return undefined;
  const current = records[index];

  const type: RemoteServerConfig['type'] = updates.type === 'streamable-http' || !updates.type ? 'streamable-http' : updates.type;
  if (type !== 'streamable-http') throw new Error('Unsupported MCP server type');

  const name = updates.name !== undefined ? sanitizeString(updates.name) : current.name;
  const url = updates.url !== undefined ? sanitizeString(updates.url) : current.url;
  if (!name) throw new Error('Name is required');
  if (!url) throw new Error('URL is required');

  const updated: McpServerRecord = {
    ...current,
    type,
    name,
    url,
    description: updates.description === null ? undefined : sanitizeString(updates.description) ?? current.description,
    note: updates.note === null ? undefined : sanitizeString(updates.note) ?? current.note,
    enabled: typeof updates.enabled === 'boolean' ? updates.enabled : current.enabled,
    updated_at: Date.now(),
  };

  const next = [...records];
  next[index] = updated;
  await writeRecords(next);
  return { ...updated };
}

export async function deleteMcpServer(id: string): Promise<boolean> {
  const records = await ensureCache();
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  await writeRecords(next);
  return true;
}
