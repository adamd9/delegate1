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
```

**Server → client**

```json
{ "type": "chat.response.delta", "content": "..." }
{ "type": "chat.response", "content": "...", "conversation_id": "..." }
```

Tool calls emit additional event types (`tool.call`, `tool.result`, etc.) — see `src/session/chat.ts` for the full list.

## `/browser-call`

Binary audio frames in both directions (base64-wrapped JSON messages), plus control frames for VAD, barge-in, and response lifecycle. The pipeline lives in `src/voice/`.

Key control messages:

- `session.start` (client) — opens a Realtime session
- `input_audio_buffer.append` (client) — incoming mic chunk
- `response.audio.delta` (server) — outbound speech chunk
- `response.audio.done` (server) — assistant finished speaking
- `input_audio_buffer.speech_started` (model event) — realtime VAD interruption trigger

## `/call`

Twilio-specific framing: each frame is `{ event: "media", media: { payload: <base64 µ-law> }}`. The server transcodes µ-law ⇄ PCM16 for the OpenAI Realtime API. Same barge-in logic as `/browser-call`.

## Barge-in invariant

In both voice paths, barge-in is handled natively by the Realtime API (`interrupt_response: true`). The server no longer drives interruption by proactively sending `response.cancel` as primary behavior; instead it flushes downstream playback buffers and suppresses stale deltas while the model auto-cancels in-flight output.
