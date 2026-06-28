---
title: Memory
parent: Features
nav_order: 6
---

# Memory

Your delegate remembers you — not just what you said in this conversation, but things you've shared over time. The more you use it, the better it understands you.

## How it works

Memory runs quietly in the background. As your conversation unfolds, the delegate is paying attention — picking up facts, preferences, and context without you having to spell them out. By the next conversation, it already knows them.

You don't need to say "remember that I..." or "last time I told you...". Relevant things from past conversations surface automatically when they're useful.

## Memory gets stronger over time

Something you mention once is noted lightly. Something that comes up again and again becomes well-established. This means a random throwaway comment won't override something your delegate has learned to know well about you.

When similar memories start to pile up, the system consolidates them — deciding whether to reinforce, merge, or discard — so your memory store stays clean and meaningful rather than filling with noise.

## Native adaptive memory

- **Adaptive memory** is always on. It builds up a picture of you on your own device, stored privately.
- Retrieval, reinforcement, deduplication, and consolidation all run through the native memory system in `src/memory/`.

## Viewing and managing your memories

You can see what your delegate remembers about you at any time:

- **Ask directly** — say something like "what do you remember about me?" and it will tell you.
- **Use the UI** — go to Settings to browse and delete individual memories.
- **Ask it to forget** — say "forget that I..." and it will remove that memory.

## Technical details

- All memory code lives under `src/memory/`.
- **Adaptive memory** extracts facts in-process and stores them on disk (`runtime-data/`).
- **Conversation bus** — a real-time pub/sub that lets the memory subsystem listen to assistant turns and extract memorable facts asynchronously after each turn.
- **Deduplicator** (`src/memory/deduplicator.ts`) — suppresses near-duplicate inserts. Unit-tested via `npm run test:unit`.
- Local memory config: `runtime-data/memory-config.json`, editable via `GET/PUT /memory-config`.

| Endpoint | Purpose |
|---|---|
| `GET /api/memories` | List stored memories |
| `DELETE /api/memories/:id` | Remove a specific memory |
| `GET /api/memories/insights` | Runtime diagnostics (dedup, store stats, recent memory runtime events) |
