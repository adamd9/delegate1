import { initMCPDiscovery } from '../../tools/mcp/adapter';
import { initToolsRegistry } from '../../tools/init';

/**
 * Initialize MCP discovery and the centralized tools registry.
 * This encapsulates startup initialization without leaking details into server.ts.
 */
export async function initToolsAndRegistry(): Promise<void> {
  await initMCPDiscovery();
  console.log('[startup] MCP discovery initialized');
  await initToolsRegistry();
}
