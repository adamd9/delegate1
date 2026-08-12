---
title: Model calling flows
parent: Reference
nav_order: 4
---

# Model calling flows

This page compares the two primary model execution paths:

- Voice channels (`/call`, `/browser-call`) through the OpenAI Realtime WebSocket API
- Text chat (`/chat`) through the OpenAI Responses API

## Quick comparison

| Dimension | Voice | Text chat |
|---|---|---|
| Transport | Realtime WebSocket API | Responses REST API |
| Default model | `gpt-realtime-2` | `gpt-5-mini` |
| Input | audio + runtime tool events | text + runtime tool events |
| Turning | server VAD / semantic VAD | explicit user turn per message |
| Tool loop | realtime events (`response.output_item.done`) | responses output function calls |
| Context bound | retention-ratio truncation | official Responses compaction |
| Cross-session continuity | durable capsule + recent turns | `previous_response_id`, capsule + recent turns when needed |

## Voice flow

Primary implementation: `src/session/call.ts` (phone) and `src/session/browserCall.ts` (browser voice).

High level:

1. Twilio or browser voice stream connects.
2. Server establishes Realtime model socket.
3. Server sends `session.update` with:
   - `type: "realtime"`
   - `output_modalities: ["audio"]`
   - current instructions and tool schemas
   - audio format (`audio/pcmu` for Twilio, `audio/pcm` for browser)
   - turn detection with `interrupt_response: true`
   - retention-ratio truncation (80% retained by default)
4. Audio flows continuously in both directions.
5. Tool calls are executed server-side and fed back to the model as function-call output items.

Twilio's G.711 µ-law frames are declared to Realtime as `audio/pcmu` and passed through directly. Browser voice uses 24 kHz PCM. The server does not transcode Twilio audio to PCM in the normal call path.

Starting or recycling a Realtime connection injects the durable continuity capsule and recent cross-channel turns into session instructions. Entering Realtime clears `previous_response_id` because that ID belongs to the Responses protocol; it does not clear the shared relationship history. Realtime `response.done` usage is persisted and can trigger a capsule refresh.

Important behavior change:

- Barge-in is now native Realtime interruption (`interrupt_response: true`).
- The server mainly handles downstream buffer flushing and stale-delta suppression, not manual cancel/truncate as the primary mechanism.

## Text chat flow

Primary implementation: `src/session/chat.ts`.

High level:

1. Client sends `chat.message` over `/chat`.
2. Server calls Responses API with model + tools + instructions, `previous_response_id` when available, and `context_management` compaction.
3. If tool calls are returned, handlers execute and outputs are fed back to Responses API.
4. Every tool follow-up uses the same compaction policy and advances the stored response ID.
5. Final assistant text is delivered to chat clients and persisted to the event ledger.

If a stored response chain ends with an unresolved tool call, the server drops the stale response ID and retries once as a fresh Responses chain. Relationship continuity still comes from the durable capsule and recent turns.

## Compaction and capsules

Responses compaction is requested on every initial call and tool continuation. When OpenAI returns a compaction output item, Delegate 1 records `context.compacted` activity and refreshes the continuity capsule. A capsule can also refresh when input usage exceeds its lower local threshold, so other protocols can resume from a compact relationship summary before the Responses chain reaches its larger compaction threshold.

The capsule-writing call is separate, uses `store: false`, and has no tools. Capsule text is internal context, not a synthetic user message. Usage, compaction, and capsule lifecycle events are persisted and shown as Inner Plane activity.

## Why this split exists

- Realtime API gives low-latency duplex audio with native interruption and voice output.
- Responses API is cost-effective and straightforward for typed chat/tool orchestration.

## Key files

- `src/session/call.ts`
- `src/session/browserCall.ts`
- `src/session/chat.ts`
- `src/agentConfigs/baseAgentConfig.ts`
