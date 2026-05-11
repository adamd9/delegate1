# Agent Bridge & MCP Server

The agent bridge provides a generic, universal entry point for external agents and async tasks to push messages into the Delegate assistant conversation.

## Architecture

```
External Agent (MCP)  ──→  /mcp (MCP Server)     ──→  agentBridge.injectMessage()
External Agent (HTTP) ──→  /api/agent/message     ──→  agentBridge.injectMessage()
Copilot CLI (hooks)   ──→  /api/copilot/callback  ──→  agentBridge.injectMessage()
                                                            ↓
                                                   handleTextChatMessage()
                                                            ↓
                                                   Assistant processes message
```

All external inputs flow through `src/services/agentBridge.ts`, which calls `handleTextChatMessage()` with the appropriate channel and metadata.

## Endpoints

### MCP Server — `POST /mcp`

A full MCP (Model Context Protocol) server using Streamable HTTP transport. External agents that speak MCP can connect and use the `message_agent` tool.

**Discovery:** `GET /mcp` returns server info and available tools.

**Tool: `message_agent`**

| Parameter  | Type   | Required | Description |
|------------|--------|----------|-------------|
| `message`  | string | ✅       | The content to deliver to the assistant |
| `sender`   | string | ✅       | Who is sending (e.g., `'copilot-cli'`, `'calendar-agent'`) |
| `source`   | string | ❌       | Originating system (e.g., `'github-actions'`, `'cron-job'`) |
| `priority` | enum   | ❌       | `'normal'`, `'high'`, or `'low'` |
| `metadata` | object | ❌       | Additional structured data (e.g., `{ conversationId: '...' }`) |

### REST API — `POST /api/agent/message`

A simple HTTP endpoint with the same parameters as the MCP tool. For agents that don't speak MCP.

```bash
curl -X POST http://localhost:8081/api/agent/message \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Build completed successfully. All 47 tests passed.",
    "sender": "ci-pipeline",
    "source": "github-actions",
    "priority": "normal"
  }'
```

### Copilot Callback — `POST /api/copilot/callback`

Existing endpoint for Copilot CLI webhook hooks. Now internally uses the agent bridge instead of calling `handleTextChatMessage()` directly.

## Channels

Messages are tagged with a `channel` that tells the assistant the source:

| Channel   | Used by |
|-----------|---------|
| `'agent'` | MCP server and REST API (generic external agents) |
| `'copilot'` | Copilot CLI callback hooks |
| `'text'`  | User chat via WebSocket |
| `'voice'` | Phone/browser voice calls |
| `'sms'`   | Twilio SMS |
| `'email'` | Email poller |
| `'walkie'`| ZeppOS walkie-talkie |

## Key Files

- `src/services/agentBridge.ts` — Core injection service
- `src/mcp/server.ts` — MCP server implementation
- `src/server/routes/agentMessage.ts` — REST API + shared payload types
- `src/server/routes/copilot.ts` — Copilot-specific callback adapter
- `src/agentConfigs/context.ts` — Channel types and context instructions
