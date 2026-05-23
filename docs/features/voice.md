---
title: Voice
parent: Features
nav_order: 2
---

# Voice (browser)

Talk to your delegate out loud — right in your browser. No phone needed, no extra apps to install. Open the voice page, click the microphone button, and have a real spoken conversation with your delegate in real time.

![Voice page](../assets/screenshots/voice.png)

## How to use it

1. Go to `/voice.html` in your browser.
2. Click the **microphone button** to start a session.
3. Start talking. Your delegate will listen and respond with speech.
4. Click the button again to end the session.

That's it. The conversation works just like talking to another person.

## Interrupting mid-sentence (barge-in)

You don't have to wait for your delegate to finish speaking before you talk. If you want to jump in, just start talking — your delegate will stop what it's saying and listen to you immediately. This makes the conversation feel natural rather than taking rigid turns.

## Voice presets

You can customise the voice your delegate speaks with — things like which voice character is used, speaking speed, and the underlying model. These are managed as **voice presets** in your settings.

## Browser voice vs. phone

| | Browser voice | Phone |
|---|---|---|
| **Setup** | None — works in any browser tab | Requires a phone number to be configured |
| **Cost** | Free | Depends on your phone plan / Twilio usage |
| **Best for** | Quick conversations at your desk | Talking while away from your computer |

Both options give you the same delegate and the same conversation — it's just a question of which device is more convenient at the time.

## Testing / simple version

`/voice-direct.html` is a stripped-down version of the voice interface that's useful for quickly checking that the microphone and audio connection are working.

![Voice direct page](../assets/screenshots/voice-direct.png)

---

## Technical details

- Audio path: browser mic → PCM16 24 kHz → `/browser-call` WebSocket → OpenAI Realtime API → PCM16 frames back → Web Audio API playback.
- Barge-in: the server calls `response.cancel` and truncates the audio buffer when new mic audio arrives mid-response. The cancel is guarded by `isResponseActivelyStreaming()` to avoid racing the Realtime API. Implementation: `src/session/browserCall.ts`, shared pipeline in `src/voice/`.
- Voice presets stored in `runtime-data/voice-presets/`; defaults from `DELEGATE_TTS_MODEL` and `DELEGATE_CHAT_VOICE_SPEED` config values.
- Voice pipeline tests: `npm run test:voice` (`src/voice/voicePipeline.test.ts`). End-to-end flows covered by `npm run test:e2e`.
- See also: [Phone (Twilio)](../phone/) — same Realtime API plumbing, different audio codec (G.711 µ-law).
