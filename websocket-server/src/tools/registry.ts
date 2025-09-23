import { FunctionHandler } from "../agentConfigs/types";

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

export function registerAgent(id: string, policy: AgentPolicy) {
  agents.set(id, clonePolicy(policy));
}

export function getAgentPolicy(id: string): AgentPolicy | undefined {
  const policy = agents.get(id);
  if (!policy) return undefined;
  return clonePolicy(policy);
}

export function updateAgentPolicy(id: string, updates: Partial<AgentPolicy>) {
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
