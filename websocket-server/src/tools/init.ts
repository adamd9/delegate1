import { registerBuiltinTools } from './providers/builtin';
import { registerLocalTools } from './providers/local';
import { registerMcpTools } from './providers/mcp';
import { registerAgent } from './registry';
import { getAgent } from '../agentConfigs';

export async function initToolsRegistry() {
  // Register providers
  registerBuiltinTools();
  registerLocalTools();
  // MCP tools are discovered asynchronously before this is called
  registerMcpTools();

  // Agent policies: allow/deny by names/tags only (minimal)
  const baseToolNames = (getAgent('base').tools || []).map(t => t.schema?.name).filter(Boolean) as string[];
  registerAgent('base', {
    // Final selection comes from agent config tools
    allowNames: baseToolNames,
  });

  const supervisorToolNames = (getAgent('supervisor').tools || []).map(t => t.schema?.name).filter(Boolean) as string[];
  registerAgent('supervisor', {
    // Supervisor selection also mirrors its agent config
    allowNames: supervisorToolNames,
  });
}
