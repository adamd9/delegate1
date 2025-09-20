import { initMCPDiscovery } from '../../tools/mcp/adapter';
import { initToolsRegistry } from '../../tools/init';

/**
 * Initialize MCP discovery and the centralized tools registry.
 * This encapsulates startup initialization without leaking details into server.ts.
 */
export async function initToolsAndRegistry(): Promise<void> {
  const summary = await initMCPDiscovery();
  console.log(
    '[startup] MCP discovery initialized',
    `(servers: ${summary.serverCount}, tools: ${summary.toolCount}, attempted: ${summary.attempted}, failed: ${summary.failed})`
  );
  await initToolsRegistry();
}
