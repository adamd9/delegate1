# Barge-in Implementation: Audio Truncation in Voice Calls

## Overview

This document explains how Delegate1 handles barge-in (user interruption) during voice calls with OpenAI's Realtime API. The implementation uses custom server-side logic to provide accurate audio truncation timing.

## Problem Context

When a user starts speaking while the assistant is talking (barge-in), we need to truncate the assistant's audio at the exact point the user heard before interrupting. This requires sending `audio_end_ms` to OpenAI's `conversation.item.truncate` event.

### The Challenge

The `audio_end_ms` value must match the **client-side playback timeline** (what the user actually heard), not the **server-side generation timeline** (when we sent the audio). This is challenging because:

1. **Network latency**: Audio sent from server takes time to reach the user
2. **Client buffering**: Twilio and browsers buffer audio before playback (~60-100ms)
3. **Packet delays**: Audio chunks may arrive at different rates

### Previous Approaches (Failed)

#### Wall-Clock Time Approach (Previous Fix - INCORRECT)
```typescript
// WRONG: Uses server-side elapsed time
const elapsedMs = Date.now() - session.responseStartTimestamp;
const audio_end_ms = elapsedMs;
```

**Problem**: This calculates how long the server has been sending audio, not how much the user has heard. It doesn't account for buffering or network delays, causing over-truncation.

#### Media Timestamp Approach (Original - ALSO INCORRECT)
```typescript
// WRONG: Uses incoming user audio timestamps
const audio_end_ms = session.latestMediaTimestamp - startTimestamp;
```

**Problem**: `latestMediaTimestamp` tracks **incoming user audio**, not **outgoing assistant audio**. These are completely different timelines.

## Correct Solution: Cumulative Audio Duration

### Implementation

We track the **cumulative duration of audio chunks sent** to the client using a helper function:

```typescript
// Helper function to calculate audio duration from base64 payload
function calculateAudioDurationMs(base64Data: string, audioFormat: 'g711_ulaw' | 'pcm16'): number {
  const base64Len = base64Data.length;
  const audioBytes = Math.floor((base64Len * 3) / 4);
  
  if (audioFormat === 'g711_ulaw') {
    // g711_ulaw @ 8kHz: 1 byte = 1 sample, 8000 samples/sec
    return audioBytes / 8;
  } else {
    // pcm16 @ 24kHz: 2 bytes = 1 sample, 24000 samples/sec
    return audioBytes / 48;
  }
}

// Track cumulative audio duration
session.responseCumulativeAudioMs = 0;

// On each audio.delta event:
if (event.delta && session.responseCumulativeAudioMs !== undefined) {
  const format = session.twilioConn ? 'g711_ulaw' : 'pcm16';
  const durationMs = calculateAudioDurationMs(event.delta, format);
  session.responseCumulativeAudioMs += durationMs;
}

// On truncation, account for buffer latency:
const BUFFER_LATENCY_MS = 100;
const audio_end_ms = Math.max(0, session.responseCumulativeAudioMs - BUFFER_LATENCY_MS);
```

### Audio Format Calculations

#### Twilio (g711_ulaw)
- Sample rate: 8kHz
- Bytes per sample: 1 (8-bit)
- Duration (ms) = bytes / 8

#### Browser (pcm16)
- Sample rate: 24kHz  
- Bytes per sample: 2 (16-bit)
- Duration (ms) = bytes / 48

### Buffer Latency

We subtract a **100ms buffer offset** to account for client-side buffering before playback. This is a conservative estimate based on:

- Twilio Media Streams: ~60-100ms typical buffering
- Browser WebRTC: ~20-100ms buffering
- Network jitter: Variable

Research shows that **not accounting for buffering** causes truncation to happen too early, cutting off audio the user actually heard.

## Barge-in Logic

### Truncation Offset (Cumulative Audio)

**Purpose**: Tell OpenAI exactly where to truncate based on what the user heard

```typescript
const audio_end_ms = Math.max(0, session.responseCumulativeAudioMs - BUFFER_LATENCY_MS);
```

**Why cumulative audio is required**: OpenAI needs the millisecond offset into the audio stream to preserve accurate conversation context. This must match the actual playback timeline.

## Code Locations

### Session State
- `websocket-server/src/session/state.ts`: Session type definitions
- Field: `responseCumulativeAudioMs?: number`

### Voice Call Handling
- `websocket-server/src/session/call.ts`:
  - `calculateAudioDurationMs()`: Helper function to calculate audio duration from base64 payloads
  - `response.audio.delta` handler: Tracks cumulative audio duration
  - `input_audio_buffer.speech_started` handler: Checks grace period before allowing barge-in
  - `handleTruncation()`: Sends truncate event with correct audio offset

### Browser Call Handling  
- `websocket-server/src/session/browserCall.ts`: Similar initialization for browser voice

### Constants
- `BUFFER_LATENCY_MS`: Client buffering estimate for truncation offset (default: 100ms)

## References

- [OpenAI Realtime API - conversation.item.truncate](https://platform.openai.com/docs/api-reference/realtime-client-events/conversation/item/truncate)
- [OpenAI Community: Correct truncation timeline](https://community.openai.com/t/openai-realtime-how-to-correctly-truncate-a-live-streaming-conversation-on-speech-interruption-twilio-media-streams/1371637)
- [Stack Overflow: Proper way to truncate with Twilio](https://stackoverflow.com/questions/79867418/openai-realtime-proper-way-to-truncate-a-live-streaming-conversation-on-speech-i)
- [Twilio Media Streams WebSocket Messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages)

## Tuning

### Adjusting Buffer Offset
Modify `BUFFER_LATENCY_MS` in `handleTruncation()` (default: 100ms). Increase if users report hearing more than expected before truncation, decrease if truncation happens too early.

### Testing
To verify correct behavior:
1. Monitor logs: `[TRUNCATE] Truncating assistant audio at Xms` shows the actual offset sent
