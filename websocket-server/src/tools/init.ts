import { registerBuiltinTools } from './providers/builtin';
import { registerLocalTools } from './providers/local';
import { registerMcpTools } from './providers/mcp';
import { registerAgent } from './registry';

export async function initToolsRegistry() {
  // Register providers
  registerBuiltinTools();
  registerLocalTools();
  // MCP tools are discovered asynchronously before this is called
  registerMcpTools();

  // Agent policies: allow/deny by names/tags only (minimal)
  registerAgent('base', {
    // Base agent gets default local tools by tag
    allowTags: ['base-default'],
  });

  registerAgent('supervisor', {
    // Supervisor can use supervisor-allowed tools (builtin, local utils, MCP)
    allowTags: ['supervisor-allowed'],
  });
}
