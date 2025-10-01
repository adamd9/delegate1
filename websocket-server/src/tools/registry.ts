import { FunctionHandler } from "../agentConfigs/types";
import { promises as fs } from 'fs';
import path from 'path';

export type ToolOrigin = 'local' | 'mcp' | 'builtin';

export interface CanonicalTool {
  id: string;
  name: string;
  sanitizedName: string;
  description?: string;
  parameters: any;
  origin: ToolOrigin;
  tags: string[];
  handler: (args: any) => Promise<string>;
}

export interface AgentPolicy {
  allowNames?: string[];
  allowTags?: string[];
}

const toolsById = new Map<string, CanonicalTool>();
const idBySanitized = new Map<string, string>();
const agents = new Map<string, AgentPolicy>();

// Persistence configuration
const RUNTIME_DIR = process.env.RUNTIME_DATA_DIR
  ? path.resolve(process.env.RUNTIME_DATA_DIR)
  : path.join(__dirname, '..', '..', 'runtime-data');
const POLICIES_FILE = path.join(RUNTIME_DIR, 'agent-policies.json');

type PersistedPolicies = Record<string, AgentPolicy>;

// Load persisted policies from disk
async function loadPersistedPolicies(): Promise<PersistedPolicies> {
  try {
    await fs.mkdir(RUNTIME_DIR, { recursive: true });
    const data = await fs.readFile(POLICIES_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('[registry] Invalid agent-policies.json format, ignoring');
      return {};
    }
    console.log('[registry] Loaded persisted policies for', Object.keys(parsed).length, 'agent(s)');
    return parsed as PersistedPolicies;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.log('[registry] No persisted policies file found, starting fresh');
      return {};
    }
    console.warn('[registry] Failed to load persisted policies:', err?.message || err);
    return {};
  }
}

// Save current policies to disk
async function savePersistedPolicies(): Promise<void> {
  try {
    await fs.mkdir(RUNTIME_DIR, { recursive: true });
    const policies: PersistedPolicies = {};
    for (const [id, policy] of agents.entries()) {
      policies[id] = clonePolicy(policy);
    }
    await fs.writeFile(POLICIES_FILE, JSON.stringify(policies, null, 2) + '\n', 'utf-8');
    console.log('[registry] Saved policies for', Object.keys(policies).length, 'agent(s)');
  } catch (err: any) {
    console.error('[registry] Failed to save persisted policies:', err?.message || err);
  }
}

// Merge persisted policies with code-defined defaults
function mergePolicies(codeDefault: AgentPolicy, persisted: AgentPolicy | undefined): AgentPolicy {
  if (!persisted) return clonePolicy(codeDefault);
  
  // Persisted values take precedence over code defaults
  return {
    allowNames: persisted.allowNames !== undefined ? persisted.allowNames : codeDefault.allowNames,
    allowTags: persisted.allowTags !== undefined ? persisted.allowTags : codeDefault.allowTags,
  };
}

export function sanitizeToolName(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function clonePolicy(policy: AgentPolicy): AgentPolicy {
  return {
    allowNames: Array.isArray(policy.allowNames)
      ? [...policy.allowNames]
      : policy.allowNames,
    allowTags: Array.isArray(policy.allowTags)
      ? [...policy.allowTags]
      : policy.allowTags,
  };
}

function normalizeOptionalStringArray(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
}

export function registerAgent(id: string, policy: AgentPolicy, persisted?: PersistedPolicies) {
  const merged = persisted?.[id] ? mergePolicies(policy, persisted[id]) : clonePolicy(policy);
  agents.set(id, merged);
}

export function getAgentPolicy(id: string): AgentPolicy | undefined {
  const policy = agents.get(id);
  if (!policy) return undefined;
  return clonePolicy(policy);
}

export async function updateAgentPolicy(id: string, updates: Partial<AgentPolicy>) {
  const existing = agents.get(id);
  if (!existing) throw new Error(`Agent not registered: ${id}`);
  const next = clonePolicy(existing);
  if (updates.allowNames !== undefined) {
    next.allowNames = normalizeOptionalStringArray(updates.allowNames) ?? [];
  }
  if (updates.allowTags !== undefined) {
    next.allowTags = normalizeOptionalStringArray(updates.allowTags) ?? [];
  }
  agents.set(id, next);
  
  // Persist to disk
  await savePersistedPolicies();
  
  return clonePolicy(next);
}

export function registerTools(providerId: string, canonical: (Omit<CanonicalTool, 'id' | 'sanitizedName'> & { name: string })[]) {
  for (const t of canonical) {
    const id = `${providerId}:${t.name}`;
    const sanitizedName = sanitizeToolName(t.name);
    const record: CanonicalTool = {
      id,
      name: t.name,
      sanitizedName,
      description: t.description,
      parameters: t.parameters,
      origin: t.origin,
      tags: t.tags,
      handler: t.handler,
    };
    toolsById.set(id, record);
    idBySanitized.set(sanitizedName, id);
  }
}

export function clearToolsByOrigin(origin: ToolOrigin) {
  for (const [id, tool] of Array.from(toolsById.entries())) {
    if (tool.origin === origin) {
      toolsById.delete(id);
      idBySanitized.delete(tool.sanitizedName);
    }
  }
}

export function resetToolsRegistry() {
  toolsById.clear();
  idBySanitized.clear();
  agents.clear();
}

export function listAllTools(): CanonicalTool[] {
  return Array.from(toolsById.values());
}

export function getSchemasForAgent(agentId: string) {
  const policy = agents.get(agentId);
  const allowSet = new Set<string>();

  const all = listAllTools();

  const allowNames = policy?.allowNames;
  if (allowNames?.length) {
    for (const t of all) if (allowNames.includes(t.name)) allowSet.add(t.id);
  }
  const allowTags = policy?.allowTags;
  if (allowTags?.length) {
    for (const t of all) if (t.tags.some(tag => allowTags.includes(tag))) allowSet.add(t.id);
  }

  const finalIds = Array.from(allowSet);
  const final = finalIds.map(id => toolsById.get(id)!).filter(Boolean);
  // Return Responses API tools list (mix of builtins and functions)
  return final.map((t) => {
    if (t.origin === 'builtin' && t.name === 'web_search') {
      return { type: 'web_search' as const };
    }
    return {
      type: 'function' as const,
      name: t.sanitizedName,
      description: t.description || '',
      parameters: t.parameters,
      strict: false as const,
    };
  });
}

export async function executeBySanitizedName(sanitizedName: string, args: any): Promise<string> {
  const id = idBySanitized.get(sanitizedName);
  if (!id) return JSON.stringify({ error: `Unknown function: ${sanitizedName}` });
  const tool = toolsById.get(id);
  if (!tool) return JSON.stringify({ error: `Tool not found for: ${sanitizedName}` });
  try {
    return await tool.handler(args);
  } catch (e) {
    return JSON.stringify({ error: `Failed to execute ${sanitizedName}` });
  }
}

export function getAgentsDebug() {
  const result: Record<string, { policy: AgentPolicy; tools: string[] }> = {};
  for (const id of agents.keys()) {
    const policy = getAgentPolicy(id) || {};
    result[id] = {
      policy,
      tools: (getSchemasForAgent(id) || []).map((s: any) => s.type === 'function' ? s.name : s.type)
    };
  }
  return result;
}

// Export persistence functions for use during initialization
export async function initializeAgentPolicies(): Promise<PersistedPolicies> {
  return await loadPersistedPolicies();
}

export async function saveAgentPolicies(): Promise<void> {
  await savePersistedPolicies();
}
