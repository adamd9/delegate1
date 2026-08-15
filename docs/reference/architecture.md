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

## Inner Context Plane

Memory, tasks, timers, and other background processors publish typed signals through the [Inner Context Plane](../../features/inner-context-plane/). A serialized Attention Broker selects relevant signals and the Context Composer presents them separately from user messages. The single base agent interprets those signals and invokes tools when action is warranted.

## Continuous timeline

The user-facing history is one chronological relationship timeline, not a stack of chats that expire on inactivity. Technical conversation IDs remain as persistence and tooling anchors, while activity inside them is divided into collapsible spans:

- user interaction bursts
- phone and browser voice activity
- autonomous inner-context activations

After the configured idle period, the current span is checkpointed and memory extraction processes only turns added since the previous checkpoint. The technical conversation, recent working state, and causal anchors remain resumable. A later message starts a new span in the same timeline, even hours later. Explicit **End conversation** closes the current technical record when a true semantic boundary is wanted; earlier records remain visible in the relationship timeline.

Queued inner signals are durable timeline events between spans. When a signal wakes the agent, the activation span contains the full claimed batch, recalled memories, tool calls and results, assistant output, and completion or failure outcome.

The SQLite event ledger is authoritative. Browser history hydration reads one globally ordered event window across technical conversation records, then reconstructs activity spans from those events. `TIMELINE_HISTORY_EVENT_LIMIT` controls the initial window, and the user can load older activity without changing model context or pruning the ledger.

## Model context continuity

The visible timeline and the model's working context are separate layers. This keeps the relationship continuous without sending an unbounded transcript to every model call:

- Text, SMS, email, and autonomous Inner Context turns use the Responses API with `previous_response_id` and official server-side compaction.
- Phone and browser voice use Realtime sessions with retention-ratio truncation.
- A durable, model-written continuity capsule preserves established facts, commitments, unresolved work, preferences, and corrections.
- Recent verbatim turns after the capsule provide exact cross-channel grounding when a model session starts or changes protocol.

Responses compaction and Realtime truncation only change model working context. They do not delete conversation events or create a visible history boundary. The latest capsule is persisted as a `context_capsule` event and restored independently during startup; recent user and assistant turns are reconstructed from the latest event window.

See [Conversation continuity](../../features/conversation-continuity/) for the user-facing model and [Model calling flows](../model-calling-flows/) for protocol details.

## Tool registry

`src/tools/registry.ts` is the canonical bus for callable capabilities. Three providers feed it:

- `local` — handlers in `src/tools/handlers/` (e.g. `web_search` wraps the OpenAI Responses builtin web search so voice and text can both use it)
- `mcp` — discovered from MCP servers in `runtime-data/mcp-servers.json`

Per-agent access is enforced by policies in `runtime-data/agent-policies.json` (tag + name allowlists).

## Durable Copilot tasks

Browser/Copilot execution is exposed as a durable task subsystem:

- REST + SSE task API in `src/server/routes/copilotTasks.ts`
- Runner/orchestration in `src/copilot/taskRunner.ts`
- Persistent task/event store in `src/copilot/tasks.ts`
- Task workdirs under `runtime-data/copilot-workdir/tasks/`

This is intentionally separate from the single-turn chat path so long-running browser jobs can pause/resume without blocking the main conversation loop.

## Memory

Two layers, plus a deduplicator and a real-time conversation bus that extracts memorable facts after each turn. See [Memory](../../features/memory/).

## Storage

| Where | What |
|---|---|
| `runtime-data/db/assistant.sqlite` | `sessions`, `conversations`, `conversation_events`, `thoughtflow_artifacts` |
| `runtime-data/*.json` | notes, MCP config, agent policies, adaptations, memory config |
| `runtime-data/voice-presets/` | voice configurations |
| `runtime-data/thoughtflow/` | run artifacts (D2) |

Local SQLite defaults to WAL mode. When `RUNTIME_DATA_DIR` points at a mounted runtime volume, SQLite defaults to rollback `DELETE` mode with a 5-second busy timeout. Production Azure Files mounts must remain in `DELETE` mode because WAL's shared-memory coordination is unsafe on SMB-backed storage.

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
