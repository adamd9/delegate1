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
4. Audio flows continuously in both directions.
5. Tool calls are executed server-side and fed back to the model as function-call output items.

Important behavior change:

- Barge-in is now native Realtime interruption (`interrupt_response: true`).
- The server mainly handles downstream buffer flushing and stale-delta suppression, not manual cancel/truncate as the primary mechanism.

## Text chat flow

Primary implementation: `src/session/chat.ts`.

High level:

1. Client sends `chat.message` over `/chat`.
2. Server calls Responses API with model + tools + instructions.
3. If tool calls are returned, handlers execute and outputs are fed back to Responses API.
4. Final assistant text is streamed and finalized to chat clients.

## Why this split exists

- Realtime API gives low-latency duplex audio with native interruption and voice output.
- Responses API is cost-effective and straightforward for typed chat/tool orchestration.

## Key files

- `src/session/call.ts`
- `src/session/browserCall.ts`
- `src/session/chat.ts`
- `src/agentConfigs/baseAgentConfig.ts`
