---
title: Phone (Twilio)
parent: Features
nav_order: 3
---

# Phone

Your delegate has a real phone number. Pick it up on your mobile, have a natural conversation, and your delegate will answer questions, search the web, and use its tools — just like a regular phone call.

This uses [Twilio](https://twilio.com) to give you a real phone number and forward calls to your delegate.

---

## What you need before you start

- A **Twilio account** — a free trial account works fine. Sign up at [twilio.com](https://www.twilio.com/try-twilio).
- A **phone number** on that Twilio account (Twilio gives you one when you sign up).
- A way for Twilio to reach your delegate over the internet:
  - **Running locally?** Use [ngrok](https://ngrok.com) to create a public URL that tunnels to your machine.
  - **Deployed to a server?** Use that server's public URL.

---

## Setup

### Step 1 — Get your Twilio credentials

1. Log in to the [Twilio Console](https://console.twilio.com/).
2. On the dashboard, find and copy:
   - **Account SID** — looks like `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - **Auth Token** — click the eye icon to reveal it
3. Note the **phone number** Twilio assigned to you (under **Phone Numbers → Active numbers**).

### Step 2 — Enter your credentials in Settings

Open your delegate's **Settings** page and fill in:

| Setting | What to paste |
|---|---|
| Twilio Account SID | Your Account SID from Step 1 |
| Twilio Auth Token | Your Auth Token from Step 1 |

Save your settings.

### Step 3 — Set your public URL

Twilio needs to know where to send calls. This is your delegate's internet-accessible address.

**If running locally with ngrok:**

```bash
ngrok http 8081
```

ngrok will print a URL like `https://abc123.ngrok.io`. Copy it.

**If deployed to a server:** use your server's public URL (e.g. `https://mydelegate.example.com`).

Paste this URL into the **Public URL** field in Settings and save.

### Step 4 — Point your Twilio number at your delegate

This is the key step: you're telling Twilio "when someone calls my number, forward it to my delegate."

1. In the [Twilio Console](https://console.twilio.com/), go to **Phone Numbers → Manage → Active numbers**.
2. Click on your phone number.
3. Under **Voice & Fax → A call comes in**, set:
   - **Webhook** (not TwiML Bin)
   - URL: `https://YOUR-PUBLIC-URL/twiml`
   - Method: **HTTP POST**
4. Click **Save configuration**.

### Step 5 — Call your number

That's it! Call your Twilio number from your mobile. Your delegate will pick up and you can have a conversation.

---

## Interrupting mid-sentence

You don't have to wait for your delegate to finish speaking. Just start talking and it will stop and listen to you — exactly like interrupting a person on a real call.

---

## After an ngrok restart

If you restart ngrok, you get a **new URL**, which means Twilio no longer knows where to find your delegate. Instead of going back to the Twilio Console every time, run:

```bash
npm run script:update-app
```

This automatically updates Twilio with your current public URL. You'll need `TWILIO_TWIML_APP_SID` set in Settings for this to work (it's the ID of a TwiML App you can create in the Twilio Console, or via `npm run script:create-app`).

---

## Troubleshooting

**The call connects but there's no audio / it hangs up immediately**
Your public URL is probably stale (this happens after an ngrok restart). Update it in Settings and run `npm run script:update-app`, then try again.

**The call doesn't connect at all**
Check that the webhook URL in your Twilio number configuration matches exactly what's in your Settings public URL field — including `https://` and the `/twiml` path at the end.

**The call keeps cutting off while your delegate is speaking**
This is usually a network issue between Twilio and your server. If you're on ngrok, try a paid ngrok plan or deploy to a server with a stable connection.

**Only one call at a time**
Your delegate handles one phone (or browser voice) call at a time. A second incoming call while one is active will be rejected.

---

## Technical details

```
Caller ──▶ Twilio PSTN ──▶ GET/POST /twiml (TwiML response)
                                    │
                         <Stream> ──▶ wss://<PUBLIC_URL>/call ──▶ OpenAI Realtime API
```

| Endpoint | Purpose |
|---|---|
| `GET/POST /twiml` | Returns TwiML that opens a media stream back to this server |
| `WS /call` | Bridges G.711 µ-law audio to OpenAI Realtime |

- Handler: `src/session/call.ts`
- TwiML template: `src/twiml.xml`
- Barge-in guard: checks `isResponseActivelyStreaming()` before issuing `response.cancel`; see `[call] response.cancel` log lines if investigating cut-off issues
- Auth: `/twiml` is on the public path list (`INSTALL_PUBLIC_PATHS`) — no auth token required for Twilio to reach it

Additional Twilio helper scripts:

| Script | Purpose |
|---|---|
| `npm run script:list-apps` | List all TwiML apps on your account |
| `npm run script:inspect-app` | Show one app's configuration |
| `npm run script:create-app` | Create a new TwiML app |
| `npm run script:update-app` | Re-point the configured TwiML app to your current public URL |
| `npm run script:token` | Generate a Twilio access token (for browser Voice SDK testing) |

See also: [SMS](../sms/), [Voice](../voice/), [Reference → WebSocket endpoints](../../reference/websocket-endpoints/).
