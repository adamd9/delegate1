---
title: Agents & policies
parent: Features
nav_order: 10
---

# Agents & policies

Delegate 1 uses a **two-tier agent model**.

## Base agent

The base agent (`src/agentConfigs/baseAgentConfig.ts`) handles every turn first. It's tuned for fast, conversational responses with a small allow-list of tools. When a turn looks complex — research, multi-step reasoning, big tool sequences — it calls a single special tool:

```
getNextResponseFromSupervisor(prompt)
```

This escalates the turn to the supervisor.

## Supervisor agent

The supervisor (`src/agentConfigs/supervisorAgentConfig.ts`) runs against the OpenAI Responses API in a loop (up to **5 iterations**), calling whatever tools it needs — `web_search`, MCP tools, local handlers — and finally returns a single answer that the base agent relays to the user.

## Registry

`src/agentConfigs/index.ts` is the agent registry. Each agent has:

- `id` (e.g. `"base"`, `"supervisor"`)
- `instructions` (system prompt)
- `model`
- `tools` (resolved at runtime via policies)

## Policies

Per-agent tool access is controlled by `runtime-data/agent-policies.json`. A policy is an allowlist combining:

- **Tags** — e.g. `messaging` → grants every tool tagged `messaging`
- **Names** — explicit allow of individual tool names

At startup you'll see:

```
[registry] Loaded persisted policies for 2 agent(s)
```

## Editing policies

There isn't a dedicated UI yet — edit `runtime-data/agent-policies.json` directly, then restart. The schema is small; copy-paste from the existing entry.

## Flow on a single turn

```
user message ──▶ base agent ──▶ (simple? answer directly)
                              └▶ (complex? getNextResponseFromSupervisor)
                                  └▶ supervisor loops:
                                        web_search / mcp.* / local.*
                                  └▶ returns answer ──▶ base relays
```

See also: [Tools](../tools/), [Reference → Model calling flows](../../reference/model-calling-flows/).
