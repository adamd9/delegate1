---
title: Tools
parent: Features
nav_order: 9
---

# Tools

Every callable capability — web search, sending email, saving a note, calling an MCP server, escalating to the supervisor — flows through a single **tool registry**.

## Providers

The registry (`src/tools/registry.ts`) accepts tools from three providers:

| Provider | Source | Examples |
|---|---|---|
| `builtin` (`src/tools/providers/builtin.ts`) | Model-native tools | `web_search` |
| `local` (`src/tools/providers/local.ts`) | TS handlers in `src/tools/handlers/` | `send_sms`, `send_email`, `save_note`, `save_memory`, etc. |
| `mcp` (`src/tools/providers/mcp.ts`) | Remote MCP servers | Whatever the connected servers expose |

## Initialization

`src/tools/init.ts` is called at startup. It loads providers in order, populates the registry, and applies policies. You'll see:

```
[startup] Tools registry initialized
```

## Listing tools

| Endpoint | Purpose |
|---|---|
| `GET /tools` | List all registered tools |
| `GET /catalog/tools` | Same, alternate path |
| `GET /agents/:id/tools` | Tools visible to a specific agent (post-policy) |

## Adding a local tool

1. Write a handler in `src/tools/handlers/your_tool.ts` that exports a `definition` and a `handler`.
2. Import it from the local provider so it gets registered at startup.
3. (If you want the base agent to see it) update `runtime-data/agent-policies.json` or add an appropriate tag.

## Tool tags

Tools are tagged (e.g. `messaging`, `memory`, `calendar`) so agent policies can grant access by tag instead of listing names individually. See [Agents & policies](../agents-and-policies/).
