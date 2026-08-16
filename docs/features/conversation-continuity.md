---
title: Conversation continuity
parent: Features
nav_order: 2
---

# Conversation continuity

Delegate 1 presents one chronological relationship timeline across text chat, browser voice, phone, SMS, email, and autonomous Inner Context work. Changing channel or returning after an idle period does not create a visible "new chat" boundary.

Three related layers make that possible:

| Layer | Purpose |
|---|---|
| Durable event ledger | Stores messages, activity spans, checkpoints, memory activity, tool calls, and context-management events in SQLite |
| Relationship timeline | Replays those events in chronological order and groups bursts of activity into collapsible spans |
| Model working context | Gives each model protocol a bounded, relevant view of the relationship without loading the entire ledger into every request |

These layers are deliberately different. A model context window can be compacted or truncated without deleting messages or creating a visible break in the relationship timeline.

## Activity spans and checkpoints

An **activity span** groups a related burst of work, such as a text exchange, a phone or browser voice session, or an autonomous Inner Context activation. Spans are UI and observability containers, not separate chats.

After the configured idle period, Delegate 1:

1. creates an incremental checkpoint;
2. sends only turns added since the previous checkpoint to memory extraction; and
3. closes the current activity span.

The technical conversation remains open and resumable. The next interaction opens another span in the same visible timeline. **End conversation** creates an explicit technical boundary when one is actually intended; it does not erase earlier history.

## Bounded model context

Text-like channels (text, SMS, email, and autonomous Inner Context turns) use the Responses API. Requests continue through `previous_response_id`, and every initial request and tool continuation enables OpenAI's official server-side compaction. Compaction shortens the model's working chain while the durable timeline remains unchanged.

The chat topbar reports current input usage as a percentage of the configured automatic compaction threshold, whether a continuity capsule is active, and the last Responses compaction time. **Compact now** calls the official Responses compaction endpoint, retains its replacement input until the next successful turn, and refreshes the durable capsule. It is disabled while a response or compaction is active.

Phone and browser voice use the Realtime API. Realtime sessions use retention-ratio truncation, which drops older model context when the session reaches its context limit while retaining a recent fraction. Starting a voice session clears the Responses chain ID because it is a different protocol, not because the relationship has restarted.

## Continuity capsules

A **continuity capsule** is a compact, model-written account of established facts, commitments, unresolved work, corrections, preferences, and cross-channel context. It is refreshed after Responses compaction or when model input usage crosses the configured capsule threshold.

Capsules are persisted as conversation events and restored on server startup. They are paired with a bounded set of recent verbatim turns that have not already been covered by the capsule. This gives a new or recycled model session both durable relationship context and exact recent wording.

Capsules supplement the event ledger; they never replace or rewrite it. Capsule text is internal model context and is not rendered as a user or assistant message.

## Startup and channel switching

On startup, Delegate 1 resumes the most recently active open technical conversation. It reconstructs recent user and assistant turns from the event ledger, restores the latest durable capsule independently, and restores an open activity span when one exists.

When the user changes channel, the next model session receives the capsule and recent cross-channel turns as needed. The visible timeline continues to show the original channel on each message.

## Inner Plane visibility

Context management is visible as expandable Inner Plane activity:

| Event | Meaning |
|---|---|
| `context.usage` | Input, output, total, and cached token usage was recorded |
| `context.compacted` | The Responses API compacted its working chain |
| `context.capsule` | A continuity capsule refresh started, completed, or failed |

Memory retrieval uses the same Inner Plane treatment. Usage, compaction, and completed capsule events are persisted and replayed inline with the activity that caused them. Late retrieval is surfaced only when deduplication and arbitration leave genuinely novel memory; delayed extraction is attached to the activity span that requested it. Capsule `started` and `failed` notifications are live observability only. None of these events impersonates a user message.

## History breadth

The browser hydrates the latest globally ordered ledger events across every technical conversation record. `TIMELINE_HISTORY_EVENT_LIMIT` controls the initial page (default 500). **Load older activity** requests the next page with a compound timestamp/event-ID cursor and prepends only those events. Pages expand to the owning span start when necessary, so a configured boundary cannot split a modern activity span. Concurrent new events remain at the newest end and cannot shift or duplicate the older page.

This setting controls replay breadth only. It is not a model token limit and does not prune SQLite; older events remain durable unless runtime data is explicitly reset or removed.

See [Model calling flows](../../reference/model-calling-flows/) for protocol details and [Runtime data](../../operations/runtime-data/) for persistence and backup guidance.