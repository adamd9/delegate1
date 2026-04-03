# Memory System

Delegate 1 includes a persistent memory system that allows the assistant to recall facts about the user across conversations. Memories are extracted automatically from completed conversations, stored in a backend (Mem0 or Adaptive), and retrieved at the start of each new turn to provide relevant context.

This document covers the full architecture, pipeline stages, configuration, and observability.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     User Message                             │
│                  (text / voice / phone)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │   Context Window       │  Build enriched query from
          │   (buildContextQuery)  │  recent conversation turns
          └───────────┬────────────┘
                      │
                      ▼
          ┌────────────────────────┐
          │   Memory Retrieval     │  Embedding search (Adaptive)
          │   (retrieve)           │  or API search (Mem0)
          │                        │  Stale-while-revalidate cache
          └───────────┬────────────┘
                      │
                      ▼
          ┌────────────────────────┐
          │   Deduplication        │  Suppress previously surfaced
          │   (MemoryDeduplicator) │  items; track new vs known
          └───────────┬────────────┘
                      │
                      ▼
          ┌────────────────────────┐
          │   Arbitrator (opt.)    │  LLM-based relevance filter
          │   (filterMemories)     │  removes irrelevant memories
          └───────────┬────────────┘
                      │
                      ▼
          ┌────────────────────────┐
          │   Injection            │  Prepended to system prompt
          │   (system instructions)│  for text, or session.update
          │                        │  for voice
          └────────────────────────┘
```

After the conversation completes, the extraction pipeline runs in reverse:

```
Completed Conversation
        │
        ▼
   Conversation Bus (event)
        │
        ▼
   Fact Extraction (LLM)  →  "- User lives in Auckland"
        │
        ▼
   Store with Consolidation  →  dedupe / merge / conflict
        │
        ▼
   Backend (Mem0 or Adaptive SQLite)
```

---

## Source Files

| File | Purpose |
|------|---------|
| `src/memory/index.ts` | **MemoryModule** singleton — retrieval, caching, extraction, orchestration |
| `src/memory/types.ts` | Core interfaces: `MemoryBackend`, `MemorySearchResult`, `CompletedConversation` |
| `src/memory/memoryConfig.ts` | Runtime config (load/save from `runtime-data/memory-config.json`) |
| `src/memory/conversationBus.ts` | Event bus — emits `conversation_complete` to trigger extraction |
| `src/memory/deduplicator.ts` | Prevents redundant memory interruptions within a conversation |
| `src/memory/arbitrator.ts` | Optional LLM-based post-retrieval relevance filter |
| `src/memory/backends/index.ts` | Backend selector (Mem0, Adaptive, or Null) |
| `src/memory/backends/mem0.ts` | Mem0 cloud API backend |
| `src/memory/backends/adaptive/index.ts` | Adaptive local backend (SQLite + embeddings) |
| `src/memory/backends/adaptive/vectorStore.ts` | SQLite storage, brute-force cosine search, reinforcement |
| `src/memory/backends/adaptive/embeddings.ts` | OpenAI `text-embedding-3-small` wrapper |
| `src/memory/backends/adaptive/consolidation.ts` | Delta analysis, conflict detection, memory merging |
| `src/memory/backends/adaptive/types.ts` | Adaptive types: `MemoryRecord`, `ScoredMemory`, `RerankWeights` |

---

## Backends

### Mem0 (Cloud)

Uses the [Mem0](https://mem0.ai) hosted service. Requires `MEM0_API_KEY` env var. Calls `client.search(query, { user_id: 'global', limit })` and `client.add(content, { user_id: 'global' })`. No local storage — all state lives in the Mem0 cloud.

### Adaptive (Local)

A fully local implementation using SQLite and OpenAI embeddings.

**Storage**: Each memory is stored as a `MemoryRecord`:

| Field | Description |
|-------|-------------|
| `content` | Canonical memory text (e.g. "User lives in Auckland") |
| `embedding` | 1536-dim vector from `text-embedding-3-small` |
| `strength` | Reinforcement score, starts at 1.0, grows with use |
| `retrievalCount` | Times this memory was retrieved |
| `deltas` | Array of consolidated differences from similar memories |
| `createdAt` | Creation timestamp |
| `lastRetrievedAt` | Last retrieval timestamp |
| `metadata` | Arbitrary metadata (channel, conversation_id, etc.) |

**Retrieval scoring formula**:

```
finalScore = α × cosineSimilarity + β × (strength / maxStrength)

Default weights: α = 0.7, β = 0.3
Minimum similarity threshold: 0.3
```

Memories with `cosineSimilarity < 0.3` are filtered out. Results are sorted by `finalScore` descending, top-K returned (default K=5).

**Strength reinforcement**: Each time a memory is retrieved, its strength increases by 0.1. Consolidation boosts strength by 0.2. This creates a natural "frequently useful memories float to the top" effect.

**Consolidation**: When storing a new memory, the system checks for existing memories with cosine similarity ≥ 0.85:

- **No match**: Store as a new independent memory
- **Consistent match**: Merge — add the delta (what's new) to the existing memory, boost strength
- **Conflicting match**: Flag the conflict; in passive extraction mode, auto-override with the newer information
- **Pure duplicate** (empty delta): Just boost strength, don't duplicate

The delta analysis uses an LLM call (`extraction_model`, default `gpt-4o-mini`) to determine relationship and extract the semantic difference.

### Null Backend

Used when neither Mem0 nor Adaptive is configured. All operations are no-ops.

---

## Retrieval Pipeline

### 1. Context Window

Before sending the query to the backend, the system enriches it with recent conversation history. This gives the embedding search richer context so it can match on conversational relevance, not just surface-level word overlap.

```
Input:  "recommend something"
History: [User: "I live in Auckland", Assistant: "That sounds great!", User: "What restaurants are nearby?"]

Enriched query:
  [Recent conversation]
  U: I live in Auckland
  A: That sounds great!
  U: What restaurants are nearby?

  [Current message]
  recommend something
```

**Configuration**:
- `context_window_turns` (default: 4) — max recent turns to include
- `context_window_max_chars` (default: 1500) — character budget for the context prefix
- Set `context_window_turns: 0` to disable

Individual turns longer than 400 characters are truncated. The window takes the most recent N turns and adds them oldest-first until the character budget is exhausted.

### 2. Stale-While-Revalidate Cache

The retrieval system implements a two-tier caching strategy to minimize latency:

**Warm cache hit** (0ms latency): If the new query is topically related to the cached query (Jaccard word-overlap ≥ 0.15), return cached results immediately. A background refresh is kicked off asynchronously so the cache stays fresh.

**Cold cache** (race against timeout): If no cache hit, race the backend fetch against the configured timeout (default 1000ms):
- **Backend wins**: Cache the result and return it
- **Timeout wins**: Return null for this turn; the backend fetch continues in the background and populates the cache for the next turn

**Late arrival callback**: When memories arrive after the timeout, callers can provide an `onLateArrival` callback. In text chat, this triggers a "shadow turn" — an internal system message that asks the agent to correct its response if the late memories change the answer. In voice, a similar shadow turn is scheduled.

### 3. Deduplication

After retrieval, the deduplicator prevents the same memories from causing repeated interruptions:

- **New items**: Not previously surfaced in this conversation → triggers interruption logic (shadow turns)
- **Known items**: Previously surfaced → included in context but not treated as "new"
- **Updated items**: Text extends a previously surfaced item → treated as new (re-surfaced)
- **Collapsed items**: Multiple items where one is a strict subset of another → only the most complete version is kept

Items expire after configurable thresholds:
- `dedup_expiry_turns` (default: 10) — re-surface after N turns
- `dedup_expiry_ms` (default: 30 minutes) — re-surface after wall-clock time

Matching modes:
- `exact` — trimmed string comparison
- `normalized` (default) — case-folded, punctuation-stripped comparison

### 4. Arbitrator (Optional)

An optional post-retrieval LLM-based filter that assesses each retrieved memory against the current conversation context and removes irrelevant ones.

**Why**: Embedding similarity alone isn't sufficient for relevance. A memory about "Auckland weather" might match a conversation about "Auckland restaurants" by cosine similarity, but isn't actually useful. The arbitrator applies conversational judgment.

**How it works**:
1. Receives the recent conversation context + current message + retrieved memories
2. Makes a single LLM call (default model: `gpt-4.1-nano` — ultra-fast, ultra-cheap)
3. The LLM returns only the memories it judges relevant
4. If the arbitrator times out or errors, falls back to unfiltered memories (safe degradation)

**Configuration**:
- `arbitrator_enabled` (default: false) — must be explicitly enabled
- `arbitrator_model` (default: `gpt-4.1-nano`) — any fast model works
- `arbitrator_timeout_ms` (default: 800ms) — timeout before falling back to unfiltered

**Prompt design**: The arbitrator is instructed to KEEP memories directly relevant to the current topic and REMOVE memories about unrelated topics, even if they share keywords. When in doubt, it removes — under-retrieval is preferred over noise.

### 5. Injection

Filtered memories are injected into the conversation:

**Text chat**: Prepended to system instructions:
```
[Retrieved memories from past conversations — use these facts when relevant to the user's query]
- User lives in Auckland
- User prefers vegetarian food

<rest of system instructions>
```

**Voice**: Injected via `session.update` message to the OpenAI Realtime API, modifying the session instructions before the next response starts.

**Shadow turns**: When memories arrive late (after the response has already started), a shadow turn is triggered — an internal message asking the agent to correct its response if the late memories change the answer. The agent responds with `[NO_CORRECTION_NEEDED]` if no correction is necessary.

---

## Extraction Pipeline

Memory extraction runs automatically when a conversation completes (triggered via the `conversationBus`).

### Process

1. **Conversation completes** → `conversationBus.emitConversationComplete(conv)`
2. **MemoryModule** receives the event, formats the full transcript:
   ```
   User: I just moved to Auckland
   Assistant: Welcome! How are you finding it?
   User: Great so far. I'm a software engineer working remotely.
   ```
3. **LLM extraction** using `extraction_model` (default `gpt-4o-mini`) with a strict prompt:
   - Only extract facts explicitly stated by the USER
   - Only stable, long-lived facts (name, location, profession, preferences)
   - No transient topics, no inferred facts, no assistant assumptions
   - Returns `NONE` if nothing qualifies
4. **Store** each extracted fact via the backend's `add()` method
5. **Cache invalidation** — the retrieval cache is cleared so the next query gets fresh data

### Extraction Prompt

```
You extract durable personal facts about the USER from a completed conversation.

Rules:
- Only extract facts explicitly stated or clearly confirmed by the USER, not inferred.
- Only include stable, long-lived facts: name, location, profession, relationships,
  firm preferences, accessibility needs, recurring patterns.
- DO NOT store: transient discussion topics, questions the assistant asked,
  options offered, facts assumed, speculative details.
- Each fact must be a single plain-text line starting with "- ".
- If there are no qualifying facts, return exactly: NONE
```

---

## Configuration

All settings are stored in `runtime-data/memory-config.json` and can be modified via:
- **Settings UI**: Settings → Memory tab
- **API**: `GET /memory-config` and `PUT /memory-config`

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `backend` | `mem0` | `mem0` / `adaptive` | Memory storage backend |
| `retrieve_timeout_ms` | 1000 | 100–10000 | Max wait for retrieval before proceeding |
| `extraction_model` | `gpt-4o-mini` | any model | LLM for fact extraction from conversations |
| `context_window_turns` | 4 | 0–20 | Recent turns to include in retrieval query (0 = disabled) |
| `context_window_max_chars` | 1500 | 0–5000 | Character budget for context prefix |
| `arbitrator_enabled` | false | bool | Enable LLM-based post-retrieval relevance filter |
| `arbitrator_model` | `gpt-4.1-nano` | any model | Model for the arbitrator |
| `arbitrator_timeout_ms` | 800 | 100–5000 | Arbitrator timeout (falls back to unfiltered) |
| `dedup_enabled` | true | bool | Enable deduplication pipeline |
| `dedup_expiry_turns` | 10 | ≥1 | Turns before re-surfacing a known memory |
| `dedup_expiry_ms` | 1800000 | ≥0 | Wall-clock ms before re-surfacing (30 min) |
| `dedup_strictness` | `normalized` | `exact` / `normalized` | Matching mode for dedup |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `MEM0_API_KEY` | Required for Mem0 backend |
| `MEM0_API_HOST` | Optional Mem0 API host override |
| `RUNTIME_DATA_DIR` | Override directory for `memory-config.json` and other runtime data |

---

## Observability

### Console Logging

The memory system logs at every pipeline stage with `[memory]` prefix:

```
[memory] context window — enriched query with 3 turns (847 chars)
[memory] retrieve — cold cache, query: "recommend something" timeout: 1000ms
[adaptive] retrieve — query: "recommend something" limit: 5, store size: 42
[adaptive] retrieve — 3 result(s) in 127ms (top score: 0.782)
[memory] retrieve — got 3 result(s) in 134ms
[memory:dedup] turn=5 total=3 new=1 known=2 suppressed=2 elapsed=0ms
[memory:dedup]   new     "- User prefers vegetarian food" | not previously surfaced
[memory:dedup]   known   "- User lives in Auckland" ← exact match (turn 2)
[memory:dedup]   known   "- User is a software engineer" ← exact match (turn 3)
[memory] arbitrator — kept 2/3 memories (312ms)
[memory] on-time: total=2 new=1
```

Cache behaviour:
```
[memory] retrieve — cache hit (age: 1200ms, overlap: 0.45), returning immediately
[memory] retrieve — cache bust (overlap: 0.08 < 0.15), doing fresh search
[memory] retrieve — timed out after 1002ms; fetch continues in background
[memory] retrieve — late result (3 result(s)), broadcasting for UI
```

Extraction:
```
[memory] extractAndStore — channel: text conv: conv_abc123 turns: 4
[memory] extraction — storing facts:
- User lives in Auckland
- User is a software engineer
[memory] extraction — stored successfully
```

### WebSocket Events

The memory system broadcasts real-time events to connected chat clients:

| Event | Fields | Description |
|-------|--------|-------------|
| `memory.retrieved` | `count`, `memories`, `source` (`cache`/`fresh`/`late`), `elapsed_ms` | Memories retrieved successfully |
| `memory.miss` | — | No matching memories found |
| `memory.pending` | `elapsed_ms` | Retrieval timed out, fetch continues in background |
| `memory.stored` | `facts`, `channel` | New facts extracted and stored |
| `memory.arbitrator` | `input_count`, `output_count`, `elapsed_ms` | Arbitrator filtering results |

### Database Events

All memory operations are persisted to `conversation_events` with these `kind` values:
- `memory_retrieved` — with source, count, elapsed_ms
- `memory_miss` — no results
- `memory_pending` — timed out
- `memory_stored` — facts extracted
- `memory_dedup` — deduplication decision log (turn, total, new, known, suppressed)
- `memory_arbitrator` — arbitrator filtering (input_count, output_count, elapsed_ms)

### ThoughtFlow Integration

Memory operations appear as steps in ThoughtFlow traces:
- `memory.retrieve` — retrieval with source and count
- `memory.store` — storage with channel and facts length
- `memory.arbitrator` — filtering with input/output counts

---

## Agent Integration

### Passive Memory (Default)

Memories are automatically retrieved and injected into the system prompt before each LLM call. The agent sees them as context but doesn't need to do anything special — the memory system is transparent.

The base agent instructions include:
```
Persistent memory:
- Relevant memories from past conversations are automatically included in your context.
- If you notice something important the user has shared, you can acknowledge it naturally
  — memory is handled passively in the background.
```

### Active Memory Tools (Adaptive Backend Only)

When using the Adaptive backend, the agent has explicit tools:

- **`retrieve_memory`** — Explicit search with full scoring details (content, strength, cosine similarity, deltas)
- **`store_memory`** — Explicit store with consolidation control and conflict reporting

These are registered in the tool registry and gated by agent policies.

---

## Tuning Guide

### Too many irrelevant memories?

1. **Enable the arbitrator**: Set `arbitrator_enabled: true` in Settings → Memory. This adds an LLM filter that removes contextually irrelevant memories.
2. **Increase context window**: Set `context_window_turns: 6` to give retrieval more conversation context for better matching.
3. **Raise minimum similarity** (Adaptive only): The threshold is currently hardcoded at 0.3 in `vectorStore.ts`. Increasing to 0.4–0.5 will be more selective.

### Memories arriving too late?

1. **Increase timeout**: Set `retrieve_timeout_ms: 2000` to give the backend more time.
2. **Pre-warm cache**: The voice channel already does this — at `speech_started`, it attempts a cache-only retrieval so memories are ready before the transcript arrives.

### Too many shadow turns / corrections?

1. **Increase dedup expiry**: Set `dedup_expiry_turns: 20` to keep known memories suppressed longer.
2. **Disable arbitrator for latency**: If the arbitrator is adding too much latency, disable it and rely on the context window improvement alone.

### Memories not being extracted?

1. **Check extraction model**: Ensure `extraction_model` is set to a capable model (default `gpt-4o-mini`).
2. **Check logs**: Look for `[memory] extraction — nothing worth storing` — this means the LLM decided no durable facts were present.
3. **Check backend availability**: Ensure `MEM0_API_KEY` is set (for Mem0) or `backend: 'adaptive'` is configured.
