---
title: Tools
parent: Features
nav_order: 9
---

# Tools

Tools are what give your delegate its capabilities beyond conversation. Think of them like apps on a phone — each one lets it do something specific, from searching the web to sending a message to checking your calendar.

You don't invoke tools directly. Just talk naturally — *"search for the latest news on X"* or *"send a text to Alex saying I'm running late"* — and the delegate figures out which tool to use.

## Built-in capabilities

These tools are available out of the box:

| What you can ask for | What it does |
|---|---|
| Search the web | Looks up current information online |
| Send an SMS | Sends a text message via your configured Twilio number |
| Send an email | Sends an email on your behalf |
| Save a note | Stores a note you can refer back to later |
| Read notes | Retrieves notes saved in previous conversations |
| Save a memory | Persists something important about you across sessions |
| Read memories | Recalls what the delegate knows about you |
| Calendar access | Available when a calendar MCP server is connected |

## Extending with MCP servers

MCP (Model Context Protocol) servers plug in additional tools — for example, a Google Calendar integration, a task manager, or a custom internal system. Once connected, those tools become available to your delegate automatically. See the [MCP Servers](../mcp-servers/) page for setup instructions.

## Permissions (agent policies)

Not every tool needs to be enabled. Policies control what the base agent is allowed to use — you can scope down messaging, memory, calendar, etc. on a per-tool basis.

You can review and adjust these permissions in `runtime-data/agent-policies.json` or via the settings UI. See [Agents & Policies](../agents-and-policies/) for details.

---

## Technical details

### Tool registry

Every tool — whether built-in, local, or from an MCP server — flows through a single registry (`src/tools/registry.ts`) populated at startup by three providers:

| Provider | Source | Examples |
|---|---|---|
| `local` | TypeScript handlers in `src/tools/handlers/` | `web_search`, `send_sms`, `send_email`, `save_note`, `save_memory` |
| `mcp` | Remote MCP servers | Whatever the connected servers expose |

`src/tools/init.ts` runs at startup, loads all providers, and applies policies.

### Listing registered tools

| Endpoint | Purpose |
|---|---|
| `GET /tools` | All registered tools |
| `GET /agents/:id/tools` | Tools visible to a specific agent after policy filtering |

### Adding a custom local tool

1. Write a handler in `src/tools/handlers/your_tool.ts` exporting a `definition` and a `handler`.
2. Import it in the local provider so it registers at startup.
3. Add it (or its tag) to `runtime-data/agent-policies.json` to grant agent access.

Tools are tagged (e.g. `messaging`, `memory`, `calendar`) so policies can grant access by category rather than by individual tool name.
