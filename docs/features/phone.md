---
title: Phone (Twilio)
parent: Features
nav_order: 3
---

# Phone (Twilio)

Inbound phone calls bridged to the OpenAI Realtime API over a single WebSocket. The same session and tools as text and browser voice.

## Architecture

```
Caller ──▶ Twilio PSTN ──▶ /twiml (TwiML response)
                          │
                          └▶ <Stream> ──▶ wss://<PUBLIC_URL>/call ──▶ OpenAI Realtime
```

| Endpoint | Purpose |
|---|---|
| `GET/POST /twiml` | Returns TwiML that bridges the call to `/call` |
| `WS /call` | G.711 µ-law audio bridge to OpenAI Realtime |

Handler: `src/session/call.ts`. TwiML template: `src/twiml.xml`.

## Setup

### 1. Expose your local server

Twilio needs to reach your server over HTTPS. ngrok is the easiest option:

```bash
npm install -g ngrok
ngrok http 8081
```

ngrok prints a public URL like `https://abc123.ngrok.io`.

### 2. Set `PUBLIC_URL`

Put it in the **Settings** UI (or `.env`):

```bash
PUBLIC_URL=https://abc123.ngrok.io
```

This is what the TwiML response uses to tell Twilio where to send the audio stream.

### 3. Add Twilio credentials

In **Settings**, set:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` (for outbound APIs)
- `TWILIO_TWIML_APP_SID` (for the auto-update script)

### 4. Configure the phone number webhook

In the [Twilio Console](https://console.twilio.com/) → **Phone Numbers → Active numbers** → pick your number:

- **A call comes in** → Webhook → `https://<PUBLIC_URL>/twiml`
- **HTTP method**: POST

### 5. Auto-update TwiML app on ngrok restarts

Each `ngrok http 8081` restart gives you a new URL. Use:

```bash
npm run script:update-app
```

This updates the Voice URL of the TwiML app referenced by `TWILIO_TWIML_APP_SID`. Related helpers in `scripts/twilio/`:

| Script | Purpose |
|---|---|
| `npm run script:list-apps` | List all TwiML apps on your Twilio account |
| `npm run script:inspect-app` | Show one app's config |
| `npm run script:create-app` | Create a new TwiML app |
| `npm run script:update-app` | Update the configured app's Voice URL to `PUBLIC_URL/twiml` |
| `npm run script:token` | Generate a Twilio access token (for browser Voice SDK testing) |

## Single active call

Only one phone or browser-voice connection can be live at a time. A second connection is rejected.

## Barge-in

Same logic as browser voice — see [Voice](../voice/#barge-in).

## Troubleshooting

- **No audio after pickup** → `PUBLIC_URL` not set or ngrok URL stale. Re-run `npm run script:update-app`.
- **Twilio webhook returns 401** → you're hitting an auth-protected path. `/twiml` is public; check `INSTALL_PUBLIC_PATHS` in `src/server/middleware/auth.ts`.
- **Cuts off mid-sentence** → the barge-in guard fired. Check `[call] response.cancel` log lines.

See also: [SMS](../sms/), [Voice](../voice/), [Reference → WebSocket endpoints](../../reference/websocket-endpoints/).
