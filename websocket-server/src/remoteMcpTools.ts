import { readFileSync } from "fs";
import { join } from "path";

interface RemoteMcpConfig {
  server_label: string;
  server_url: string;
  api_key?: string;
}

export function loadRemoteMcpTools() {
  try {
    const filePath = join(__dirname, "../../data/mcp-tools.json");
    const raw = readFileSync(filePath, "utf-8");
    const configs: RemoteMcpConfig[] = JSON.parse(raw);
    return configs.map(cfg => {
      const tool: any = {
        type: "mcp",
        server_label: cfg.server_label,
        server_url: cfg.server_url
      };
      if (cfg.api_key) {
        tool.headers = { Authorization: `Bearer ${cfg.api_key}` };
      }
      return tool;
    });
  } catch (err) {
    console.warn("No remote MCP tools loaded", err instanceof Error ? err.message : err);
    return [];
  }
}
