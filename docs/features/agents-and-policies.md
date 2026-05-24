---
title: Agents & policies
parent: Features
nav_order: 10
---

# Agents & policies

Your delegate runs as a single agent with a focused set of tools. When it needs information beyond what it already knows, it reaches for a tool — most commonly `web_search` for up-to-date facts — and weaves the result into its reply. You just ask; it picks the right tool.

## What it can do

The base agent has a curated set of capabilities: messaging (SMS, email), notes, persistent memory, GitHub, calendar (via MCP), a browser-driven Copilot for interactive tasks, and `web_search` for fresh information from the web. If something takes a little longer, that's a tool call running behind the scenes — on phone calls a gentle hold-music pulse keeps you company while the lookup completes.

Capabilities are managed automatically. To customise which tools the agent can use, see the Technical details below.

## Technical details

### Single base agent

- **Base agent** — configured in `src/agentConfigs/baseAgentConfig.ts`. Handles every turn. Calls tools (local handlers, MCP tools, or `web_search`) as needed.
- **`web_search` tool** — local function tool (`src/tools/handlers/web-search.ts`) that wraps a single OpenAI Responses API call with the builtin web_search tool enabled. The wrapper exists because the Realtime API (voice) only accepts function tools, not OpenAI builtin tool types — wrapping makes web search available on text, voice, and phone uniformly.
- **Agent registry** — `src/agentConfigs/index.ts`. Each agent has an `id`, `instructions` (system prompt), `model`, and `tools` (resolved at runtime via policies).

### Policies

Per-agent tool access is controlled by `runtime-data/agent-policies.json`. A policy is an allowlist combining:

- **Tags** — e.g. `base-default` grants every tool tagged that way
- **Names** — explicit allow of individual tool names

To customise, edit `runtime-data/agent-policies.json` directly and restart, or use the settings UI. At startup the log will confirm: `[registry] Loaded persisted policies for 1 agent(s)`.

### Turn flow

```
user message ──▶ base agent ──▶ answer (direct)
                         │
                         └▶ tool call (web_search / local.* / mcp.*)
                               └▶ tool result fed back ──▶ final answer
```

The standard function-call loop runs up to 8 iterations, allowing the agent to chain tools (e.g. `web_search` followed by `create_note` and `send_sms`) before producing the final reply.

See also: [Tools](../tools/), [Reference → Model calling flows](../../reference/model-calling-flows/).
