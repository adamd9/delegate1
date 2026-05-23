---
title: Memory
parent: Features
nav_order: 6
---

# Memory

Delegate 1 has a layered memory system that gives the assistant durable context across sessions and channels.

## Layers

1. **Adaptive (local) memory** — facts extracted in-process and stored on disk. Always on.
2. **Mem0** (optional) — hosted long-term memory backend via `mem0ai`. Enabled when `MEM0_API_KEY` is set.
3. **Conversation bus** — a real-time pub/sub that lets the memory subsystem listen to assistant turns and extract memorable facts asynchronously.
4. **Deduplicator** (`src/memory/deduplicator.ts`) — suppresses near-duplicate inserts. Unit-tested via `npm run test:unit`.

All memory code lives under `src/memory/`.

## How memories show up

- A tool call (`recall_memory`, `save_memory`) lets the agent query and write explicitly.
- The conversation bus extracts candidate facts implicitly after each turn; the deduplicator decides whether to actually persist them.
- Active memories are injected into the agent's context window on each turn.

## Config

| Key | Purpose |
|---|---|
| `MEM0_API_KEY` | Enables Mem0 hosted memory |
| `MEM0_API_HOST` | Override the Mem0 API host (defaults to cloud) |

The local memory config lives in `runtime-data/memory-config.json` and is editable via the API (`GET/PUT /memory-config`).

## Listing memories

| Endpoint | Purpose |
|---|---|
| `GET /api/memories` | List stored memories |
| `DELETE /api/memories/:id` | Remove one |

## Tests

```bash
npm run test:unit   # exercises the deduplicator
```
