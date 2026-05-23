---
title: Voice
parent: Features
nav_order: 2
---

# Voice (browser)

Real-time browser voice with barge-in. Audio is PCM16 at 24 kHz, streamed over the `/browser-call` WebSocket.

![Voice page](../assets/screenshots/voice.png)

## Endpoints

| Path | Type | Purpose |
|---|---|---|
| `/browser-call` | WebSocket | Bidirectional audio + control messages |
| `/voice.html` | static | Full voice UI |
| `/voice-direct.html` | static | Minimal direct test harness |

Handler: `src/session/browserCall.ts`. Pipeline: `src/voice/`.

## How it works

1. The browser captures mic audio, downsamples to 24 kHz PCM16, and streams chunks over the WebSocket.
2. The backend forwards audio to the OpenAI Realtime API.
3. Outbound audio (agent speech) streams back as base64-encoded PCM16 frames and is played through Web Audio API.
4. The backend tracks `responseStartTimestamp` to know when the assistant is actively speaking.

## Barge-in

When the user starts speaking while the assistant is mid-response, the server cancels the in-flight response (`response.cancel`) and truncates the audio buffer. The cancel call is guarded by `isResponseActivelyStreaming()` — without this check, you can race the Realtime API and corrupt state. This logic lives in `src/session/call.ts` and is shared with the Twilio phone path.

## Voice presets

Voice configuration (model, voice id, speed, instructions) is stored as presets in `runtime-data/voice-presets/`. Defaults come from `DELEGATE_TTS_MODEL` and `DELEGATE_CHAT_VOICE_SPEED` in the config store.

## Testing

```bash
npm run test:voice   # ts-node src/voice/voicePipeline.test.ts
```

End-to-end voice flows are also exercised by the Playwright suite (`npm run test:e2e`).

See also: [Phone (Twilio)](../phone/) — same Realtime API plumbing, different audio codec (G.711 µ-law).
