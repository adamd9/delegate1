# Voice Message API Spec (Delegate 1)

This document describes the REST endpoint and client behavior for uploading a short audio recording, receiving a transcript + assistant reply, and returning synthesized audio.

## Overview

Pipeline:

1) Speech-to-Text (STT) → `user_text`
2) Delegate conversation handler (same path as text/SMS) → `assistant_text`
3) Text-to-Speech (TTS, chat voice config) → `assistant_audio` (MP3, base64)

## Base URL

- Local: `http://localhost:8081`
- Path prefix: `/api`

## Endpoint

### POST `/api/voice/message`

Accepts a short audio recording as multipart form data and returns transcript + assistant reply + MP3 audio.

#### Auth

- No auth required in current implementation.

#### Request

Content-Type: `multipart/form-data`

Fields:

- `audio` (file, required)
  - Allowed formats: `.mp3`, `.mp4`, `.m4a`, `.wav`, `.webm`, `.ogg`, `.opus`, `.mpeg`, `.mpga`
  - MIME types accepted: `audio/mpeg`, `audio/mp3`, `audio/mp4`, `audio/x-m4a`, `audio/m4a`, `audio/wav`, `audio/x-wav`, `audio/webm`, `video/webm`, `audio/ogg`, `audio/opus`, `audio/mpga`
- `conversation_id` (string, optional)
  - If provided, the server continues that conversation.
  - If absent, a new conversation is created.
- `end_conversation` (boolean, optional)
  - `true` or `false` (string or boolean). Default `false`.
- `meta` (JSON string, optional)
  - Client metadata: name/version, platform, etc.

#### Response (200)

```json
{
  "conversation_id": "conv_req_...",
  "user_text": "transcribed speech",
  "assistant_text": "assistant reply",
  "assistant_audio": {
    "format": "mp3",
    "base64": "<base64-encoded mp3>"
  },
  "timings_ms": {
    "stt": 123,
    "llm": 456,
    "tts": 321,
    "total": 900
  }
}
```

#### Errors

- `400` — `missing_audio`
  - `{"error":"missing_audio","message":"Missing audio file"}`
- `413` — `audio_too_large`
  - `{"error":"audio_too_large","message":"Audio file exceeds size limit"}`
- `415` — `unsupported_audio`
  - `{"error":"unsupported_audio","message":"Unsupported audio type"}`
- `502` — `openai_upstream_error`
  - `{"error":"openai_upstream_error","message":"OpenAI request failed","request_id":"..."}`
- `500` — `server_error`

## Conversation Behavior

- Uses the same internal handler as text/SMS so history/tools/policies match.
- Conversation ID continuity is supported by supplying `conversation_id`.
- If `end_conversation=true`, the server finalizes the conversation after generating the reply.

## Audio Recording Notes (Client)

- The test miniapp records using Opus (`audio/webm;codecs=opus` with `audio/ogg;codecs=opus` fallback).
- Any of the allowed formats above can be sent to the endpoint.

## Environment Variables

- `OPENAI_API_KEY` (required) — OpenAI API key for STT/TTS + chat.
- `DELEGATE_MAX_AUDIO_BYTES` (optional, default `2097152`) — Max upload size in bytes.
- `DELEGATE_TTS_MODEL` (optional, default `gpt-4o-mini-tts`) — TTS model.
- `DELEGATE_CHAT_VOICE_SPEED` (optional, default `1.3`) — TTS speed.

## Miniapp (Built-in Tester)

- URL: `/miniapps/voice_message_tester/index.html`
- Integrated in the top-right menu of the main web UI.

## Example cURL

```bash
curl -X POST "http://localhost:8081/api/voice/message" \
  -F "audio=@./sample.webm" \
  -F "conversation_id=conv_123" \
  -F "end_conversation=false" \
  -F 'meta={"client":"example","version":"1.0.0"}'
```
