---
title: SMS
parent: Features
nav_order: 4
---

# SMS (Twilio)

Send and receive SMS through the same Twilio account used for phone calls.

## Inbound

Twilio's "When a message comes in" webhook should point at:

```
POST https://<PUBLIC_URL>/sms
```

Incoming messages are dispatched into the agent and the response is sent back over SMS. The handler lives in `src/sms.ts`; transient inbound state is tracked in `src/smsState.ts`.

## Outbound

The agent has a `send_sms` tool (registered via the local tool provider). It uses the Twilio REST API directly via the `twilio` package.

## Config

Set these via the **Settings** UI:

| Key | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Voice + SMS account (default) |
| `TWILIO_SMS_ACCOUNT_SID` / `TWILIO_SMS_AUTH_TOKEN` | Separate SMS-only account (optional) |
| `TWILIO_MESSAGING_SERVICE_SID` | Messaging Service to send from |
| `TWILIO_SMS_DEFAULT_TO` | Fallback destination number if none is detected from context |

If `TWILIO_SMS_ACCOUNT_SID` is set, the SMS code uses it instead of the voice account.

## Webhook URL

In Twilio Console → **Phone Numbers → Active numbers** → your number:

- **A message comes in** → Webhook → `https://<PUBLIC_URL>/sms`
- HTTP method: POST

See also: [Phone (Twilio)](../phone/) for the broader Twilio account setup.
