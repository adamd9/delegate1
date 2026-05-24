---
title: Architecture
parent: Reference
nav_order: 5
---

# Architecture

A condensed view of how Delegate 1 fits together. For per-feature detail, follow the links from [Features](../../features/).

## One process, one session

The entire app is a single Node process (`src/server.ts`):

- Express HTTP server on port `8081`
- WebSocket upgrade handler routed by path (`/chat`, `/call`, `/browser-call`)
- Static frontend served from `client/`
- SQLite (better-sqlite3) for conversation events
- An **in-memory session singleton** (`src/sessionSingleton.ts` / `src/session/state.ts`) shared by every channel

There is no per-user or per-request isolation. Multiple chat clients can observe the singleton; only one voice/phone connection can hold it at a time.

## Single base agent

```
user turn ──▶ base agent ──▶ answer
                       │
                       ├▶ web_search (wraps Responses builtin web_search)
                       ├▶ local tools (notes, sms, email, github, memory, …)
                       └▶ mcp tools
```

- **Base agent** (`src/agentConfigs/baseAgentConfig.ts`) — handles every turn. Calls tools as needed (including `web_search` for fresh information).
- **Registry** (`src/agentConfigs/index.ts`).

## Tool registry

`src/tools/registry.ts` is the canonical bus for callable capabilities. Three providers feed it:

- `local` — handlers in `src/tools/handlers/` (e.g. `web_search` wraps the OpenAI Responses builtin web search so voice and text can both use it)
- `mcp` — discovered from MCP servers in `runtime-data/mcp-servers.json`

Per-agent access is enforced by policies in `runtime-data/agent-policies.json` (tag + name allowlists).

## Memory

Two layers, plus a deduplicator and a real-time conversation bus that extracts memorable facts after each turn. See [Memory](../../features/memory/).

## Storage

| Where | What |
|---|---|
| `runtime-data/db/assistant.sqlite` | `sessions`, `conversations`, `conversation_events`, `thoughtflow_artifacts` |
| `runtime-data/*.json` | notes, MCP config, agent policies, adaptations, memory config |
| `runtime-data/voice-presets/` | voice configurations |
| `runtime-data/thoughtflow/` | run artifacts (D2) |

## Channels

All channels read/write the same singleton:

| Channel | Path | Codec |
|---|---|---|
| Text | `WS /chat` | text |
| Browser voice | `WS /browser-call` | PCM16 24 kHz |
| Phone | `WS /call` via `/twiml` | G.711 µ-law |
| SMS | `POST /sms` | text |
| Email | IMAP poller | text |

## Reference implementations

The design draws from two upstream samples:

1. **OpenAI Realtime Agents** — multi-modal agent UX
2. **Twilio Realtime Demo** — backend-centric single-session pattern

Delegate 1 keeps the Twilio demo's "single backend session" idea and extends it across every channel.
