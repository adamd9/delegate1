---
title: MCP servers
parent: Features
nav_order: 8
---

# MCP servers

Delegate 1 speaks the [Model Context Protocol](https://modelcontextprotocol.io/). Any MCP-compatible server you configure has its tools auto-discovered and registered with the agent.

![MCP servers UI](../assets/screenshots/mcp-servers.png)

## Configuration

Servers are listed in `runtime-data/mcp-servers.json`:

```json
{
  "servers": [
    {
      "id": "user-calendar-and-events",
      "url": "https://cmp.drop37.com/mcp",
      "transport": "http"
    }
  ]
}
```

Edit via the **MCP servers** UI at `/mcp-servers.html` or the API:

| Method | Path |
|---|---|
| GET | `/api/mcp/config` |
| POST | `/api/mcp/config` |

## Discovery

At startup the MCP adapter (`src/mcp/`) connects to each server, lists its tools, and registers them through the canonical tool registry under the `mcp` provider. You'll see this in the logs:

```
[mcpClient] Connecting to MCP server user-calendar-and-events at https://...
[mcpClient] Discovered 5 tools on user-calendar-and-events
[mcpAdapter] MCP discovery complete. 5 tool(s) registered.
```

## Access control

Whether a particular agent can invoke a particular MCP tool is governed by **agent policies** — see [Agents & policies](../agents-and-policies/). MCP tools are tagged so you can allow them in bulk by tag.

## Adding a new server

1. Open `/mcp-servers.html`.
2. Click **Add server**, paste the URL, save.
3. Restart (or trigger re-discovery) and the new tools become available.
