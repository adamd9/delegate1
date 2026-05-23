---
title: Agents & policies
parent: Features
nav_order: 10
---

# Agents & policies

Your delegate thinks in two modes — a quick mode for everyday questions, and a deeper mode for harder ones. It switches between them automatically. You just ask; it figures out who handles it.

## Two modes of thinking

Think of your delegate like a smart personal assistant who handles most tasks themselves but escalates the tricky ones to a senior expert. You never need to decide — your delegate reads the situation and routes accordingly.

**Quick mode (the base)** — handles most of what you ask. Conversational, fast, and capable of a curated set of actions: sending messages, checking notes, looking things up. If your question is straightforward, you get an answer in seconds.

**Deep thinking mode (the supervisor)** — kicks in when something is genuinely complex: multi-step research, questions that require cross-referencing several sources, or tasks that need a sequence of actions to get right. The supervisor works through the problem step by step — searching the web, reading your notes, checking your calendar — and only comes back when it has a complete answer. Your delegate then delivers that answer to you.

You'll notice deep thinking mode when a response takes a little longer — that's your delegate doing real work behind the scenes.

## What each mode can do

Each mode has a defined set of capabilities — think of it as a permissions list. Quick mode has a focused, curated set of tools suited to fast responses. Deep thinking mode has broader access, letting it pull in whatever it needs to solve a harder problem.

These capabilities are managed automatically. If you'd like to customise which tools each mode can use, see the Technical details section below.

## Technical details

### Two-tier agent model

- **Base agent** — configured in `src/agentConfigs/baseAgentConfig.ts`. Handles every turn first. When a turn is complex, it calls `getNextResponseFromSupervisor(prompt)` to escalate.
- **Supervisor agent** — configured in `src/agentConfigs/supervisorAgentConfig.ts`. Runs against the OpenAI Responses API in a loop (up to **5 iterations**), calling tools such as `web_search`, MCP tools, and local handlers, then returns a single answer that the base agent relays to the user.
- **Agent registry** — `src/agentConfigs/index.ts`. Each agent entry has an `id`, `instructions` (system prompt), `model`, and `tools` (resolved at runtime via policies).

### Policies

Per-agent tool access is controlled by `runtime-data/agent-policies.json`. A policy is an allowlist combining:

- **Tags** — e.g. `messaging` grants every tool tagged `messaging`
- **Names** — explicit allow of individual tool names

To customise, edit `runtime-data/agent-policies.json` directly and restart. There is no dedicated UI yet. At startup the log will confirm: `[registry] Loaded persisted policies for 2 agent(s)`.

### Turn flow

```
user message ──▶ base agent ──▶ (simple? answer directly)
                              └▶ (complex? getNextResponseFromSupervisor)
                                  └▶ supervisor loops:
                                        web_search / mcp.* / local.*
                                  └▶ returns answer ──▶ base relays
```

See also: [Tools](../tools/), [Reference → Model calling flows](../../reference/model-calling-flows/).
