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
  denyNames?: string[];
  denyTags?: string[];
}

const toolsById = new Map<string, CanonicalTool>();
const idBySanitized = new Map<string, string>();
const agents = new Map<string, AgentPolicy>();

export function sanitizeToolName(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function registerAgent(id: string, policy: AgentPolicy) {
  agents.set(id, policy);
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

export function listAllTools(): CanonicalTool[] {
  return Array.from(toolsById.values());
}

export function getSchemasForAgent(agentId: string) {
  const policy = agents.get(agentId) || {};
  const allowSet = new Set<string>();
  const denySet = new Set<string>();

  const all = listAllTools();

  if (policy.allowNames && policy.allowNames.length) {
    for (const t of all) if (policy.allowNames.includes(t.name)) allowSet.add(t.id);
  }
  if (policy.allowTags && policy.allowTags.length) {
    for (const t of all) if (t.tags.some(tag => policy.allowTags!.includes(tag))) allowSet.add(t.id);
  }

  // If no explicit allow provided, default to allow nothing (explicit opt-in)

  if (policy.denyNames && policy.denyNames.length) {
    for (const id of Array.from(allowSet)) {
      const t = toolsById.get(id);
      if (t && policy.denyNames.includes(t.name)) denySet.add(id);
    }
  }
  if (policy.denyTags && policy.denyTags.length) {
    for (const id of Array.from(allowSet)) {
      const t = toolsById.get(id);
      if (t && t.tags.some(tag => policy.denyTags!.includes(tag))) denySet.add(id);
    }
  }

  const finalIds = Array.from(allowSet).filter(id => !denySet.has(id));
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
  const result: any = {};
  for (const [id, policy] of agents.entries()) {
    result[id] = {
      policy,
      tools: (getSchemasForAgent(id) || []).map((s: any) => s.type === 'function' ? s.name : s.type)
    };
  }
  return result;
}
