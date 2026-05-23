---
title: SMS
parent: Features
nav_order: 4
---

# SMS

Text your delegate the same way you'd text a person. It reads your message, thinks about it, and texts you back.

You can have full back-and-forth conversations over SMS, ask questions, give instructions, or just check in — no app needed. Your delegate uses the same Twilio phone number as voice calls, so there's nothing extra to buy.

---

## Setting up SMS

If you've already set up phone calls, you may only need to add one webhook in Twilio. Here's the full walkthrough:

### Step 1 — Check your credentials in Settings

Open **Settings** in the delegate UI and confirm these fields are filled in (they'll already be there if you set up phone calls):

- **Twilio Account SID**
- **Twilio Auth Token**
- **Twilio Phone Number** — this is the number you'll text to and from

### Step 2 — Add the SMS webhook in Twilio Console

1. Log in to [console.twilio.com](https://console.twilio.com)
2. Go to **Phone Numbers → Manage → Active Numbers**
3. Click your number
4. Scroll to the **Messaging** section
5. Under **A message comes in**, set:
   - **Webhook**
   - URL: `https://<your-delegate-public-url>/sms`
   - Method: **HTTP POST**
6. Click **Save**

> If you used the same number for phone calls and SMS, this may already be set. Just verify the URL is correct.

### Step 3 — (Optional) Set a default SMS number

If you want your delegate to be able to text you proactively — without you texting first — go to **Settings** and fill in **SMS Default To**. This is the number your delegate will use when it needs to send you a message on its own initiative (for example, if you asked it to remind you via text about something).

---

## What to expect

**Texting your delegate:**
Send a text to your Twilio number. Your delegate will process it and reply via SMS, usually within a few seconds.

**Your delegate texting you:**
Your delegate has the ability to send you a text at any time — not just in reply to one you sent. For example:

> *"Remind me via text when the package ships."*

Your delegate will send you an SMS when it has something to tell you, using the number you configured in **SMS Default To**.

---

## Troubleshooting

- **No reply?** Double-check the webhook URL in Twilio Console and make sure your delegate is running and publicly reachable.
- **"Undelivered" in Twilio?** Check that your Twilio number has SMS capability enabled.
- **Proactive texts not working?** Make sure **SMS Default To** is set in Settings.

---

## Technical details

- Inbound SMS handler: `src/sms.ts`; transient inbound state tracked in `src/smsState.ts`
- Webhook route: `POST /sms`
- Outbound SMS uses the `send_sms` tool registered via the local tool provider, calling the Twilio REST API via the `twilio` npm package
- If `TWILIO_SMS_ACCOUNT_SID` / `TWILIO_SMS_AUTH_TOKEN` are set in Settings, the SMS code uses that account instead of the default voice account — useful if you want to split SMS and voice billing
- `TWILIO_MESSAGING_SERVICE_SID` can be set to send via a Twilio Messaging Service instead of a direct number
- `TWILIO_SMS_DEFAULT_TO` is the fallback destination number for proactive outbound messages when no destination can be inferred from context

See also: [Phone (Twilio)](../phone/) for the broader Twilio account setup.
