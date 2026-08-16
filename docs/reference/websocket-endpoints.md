---
title: WebSocket endpoints
parent: Reference
nav_order: 3
---

# WebSocket endpoints

Routed in `src/ws/attach.ts` by URL path. Only one voice/call connection can be active at a time; the chat WS allows multiple clients.

| Path | Audio codec | Handler | Use |
|---|---|---|---|
| `/chat` | — | `src/session/chat.ts` | Text chat |
| `/browser-call` | PCM16 24 kHz | `src/session/browserCall.ts` | Browser voice |
| `/call` | G.711 µ-law | `src/session/call.ts` | Twilio phone calls |

## `/chat`

**Client → server**

```json
{ "type": "chat.message", "content": "..." }
{ "type": "history.more", "cursor": { "createdAtMs": 1700000000000, "id": "event-id" } }
```

**Server → client**

```json
{ "type": "chat.working", "request_id": "..." }
{ "type": "chat.response", "content": "...", "conversation_id": "..." }
{ "type": "chat.done", "request_id": "..." }
{ "type": "history.page.start", "mode": "prepend" }
{ "type": "history.page", "mode": "prepend", "next_cursor": { "createdAtMs": 1699999999000, "id": "older-event-id" }, "has_more": true }
```

Timeline replay and live observability also use `conversation.item.*`, `timeline.span.*`, `memory.*`, `inner.activation`, `context.usage`, `context.compacted`, and `context.capsule` events. Initial replay is a bounded global event page; older cursor pages are bracketed by `history.page.start` and `history.page` so the client can prepend them atomically. Context and memory events render as Inner Plane activity rather than user messages. See `src/session/chat.ts` and `src/session/history.ts` for the complete mapping.

## `/browser-call`

Binary audio frames in both directions (base64-wrapped JSON messages), plus control frames for VAD, barge-in, and response lifecycle. The pipeline lives in `src/voice/`.

Key control messages:

- `session.start` (client) — opens a Realtime session
- `input_audio_buffer.append` (client) — incoming mic chunk
- `media` (server) — outbound speech chunk
- `response.audio.done` (model event handled by the server) — assistant finished generating audio
- `input_audio_buffer.speech_started` (model event) — realtime VAD interruption trigger

## `/call`

Twilio-specific framing: each frame is `{ event: "media", media: { payload: <base64 µ-law> }}`. The server declares the stream as `audio/pcmu` and passes the µ-law payload directly to and from the OpenAI Realtime API. Same barge-in logic as `/browser-call`.

## Barge-in invariant

In both voice paths, barge-in is handled natively by the Realtime API (`interrupt_response: true`). The server no longer drives interruption by proactively sending `response.cancel` as primary behavior; instead it flushes downstream playback buffers and suppresses stale deltas while the model auto-cancels in-flight output.
