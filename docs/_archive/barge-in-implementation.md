# Barge-in Implementation: Unconditional Cancel + Truncate

## Overview

This document explains how Delegate1 handles barge-in (user interruption) during voice calls with OpenAI Realtime.

The current approach is intentionally simple:

1. On `input_audio_buffer.speech_started`, immediately send `response.cancel`
2. If there is an assistant item to truncate, send `conversation.item.truncate`
3. Send `clear` to client audio playback (Twilio/browser)
4. Suppress `response_cancel_not_active` noise entirely

## Why this approach

Previous guarded-cancel logic tried to infer whether a response was still active. In practice, this introduced race-condition complexity and inconsistent interruption behavior.

Now we prefer deterministic behavior:

- Always attempt cancel on interruption
- Ignore harmless cancel-not-active errors
- Keep truncation based on cumulative sent audio for context correctness

## Current Runtime Behavior

### 1) Interruption signal (`input_audio_buffer.speech_started`)

On every speech-start event, backend sends:

```typescript
jsonSend(session.modelConn, { type: "response.cancel" });
```

This send is unconditional when model socket is open.

### 2) Truncation path

If `lastAssistantItem` and `responseCumulativeAudioMs` are available, backend computes:

```typescript
const audio_end_ms = Math.floor(Math.max(0, responseCumulativeAudioMs - BUFFER_LATENCY_MS));
```

Then sends:

```typescript
jsonSend(session.modelConn, {
  type: "conversation.item.truncate",
  item_id: lastAssistantItem,
  content_index: 0,
  audio_end_ms,
});
```

### 3) Playback clear

Backend clears queued audio at client side:

- Twilio: `event: "clear"`
- Browser: `event: "clear"`

### 4) Error suppression

`response_cancel_not_active` is intentionally suppressed:

- Not forwarded to frontend logs
- Not emitted as backend error noise

This keeps logs focused on actionable failures.

## Audio Offset Calculation

### Cumulative audio duration

Duration is derived from bytes in outgoing `response.audio.delta` payloads:

```typescript
function calculateAudioDurationMs(base64Data: string, audioFormat: 'g711_ulaw' | 'pcm16'): number {
  const base64Len = base64Data.length;
  const audioBytes = Math.floor((base64Len * 3) / 4);

  if (audioFormat === 'g711_ulaw') {
    return audioBytes / 8;   // 8kHz ulaw
  }
  return audioBytes / 48;    // 24kHz pcm16
}
```

### Buffer compensation

```typescript
const BUFFER_LATENCY_MS = 100;
const audio_end_ms = Math.floor(Math.max(0, responseCumulativeAudioMs - BUFFER_LATENCY_MS));
```

This is used only for truncate offset quality, not for deciding whether to cancel.

## Code Locations

### Voice handling

- `websocket-server/src/session/call.ts`
  - `input_audio_buffer.speech_started` handler: unconditional `response.cancel`
  - `handleTruncation()`: truncate + clear behavior
  - `response.audio.delta` handler: cumulative audio tracking
  - `shouldForwardToFrontend()`: suppress cancel-not-active forwarding
  - `case "error"`: suppress cancel-not-active backend noise

### Session state

- `websocket-server/src/session/state.ts`
  - `lastAssistantItem`
  - `responseCumulativeAudioMs`
  - `responseStartTimestamp` (tracking/debug context)

## Observability

Look for these logs:

- `[BARGE-IN] input_audio_buffer.speech_started received`
- `[BARGE-IN] Sending unconditional response.cancel on speech_started`
- `[TRUNCATE] Truncating assistant audio at Xms ...`
- `[BARGE-IN] Sending conversation.item.truncate`
- `[BARGE-IN] Sending browser clear event` or Twilio clear logs

You should no longer see noisy `response_cancel_not_active` error propagation.

## Tuning

`BUFFER_LATENCY_MS` can still be tuned for better truncate offset quality:

- Increase if users report hearing more than expected before cutoff
- Decrease if cutoff sounds too early

This does not affect unconditional cancel behavior.
