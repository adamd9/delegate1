---
title: Email
parent: Features
nav_order: 5
---

# Email

Your delegate has its own email address. Send it an email and it emails you back — that's the core idea. It's great for longer requests, tasks where you want to attach context, or anything where you don't need an instant reply and prefer to work asynchronously.

Your delegate can also send email on its own initiative when you ask it to — for example, "send a summary to my team" or "email me that report."

## Setting up email

You'll need an email account dedicated to your delegate (a Gmail alias or a Fastmail address both work well). The account needs to support **IMAP** (for receiving mail) and **SMTP** (for sending mail) — any standard mail provider supports this.

### Step-by-step

1. Open **Settings** in the delegate UI.
2. Fill in the **incoming mail (IMAP)** fields:
   - **IMAP host** — your provider's incoming mail server (e.g. `imap.gmail.com`)
   - **IMAP port** — usually `993` for a secure connection
   - **Username** — the email address
   - **Password** — the account password (or an app-specific password if your provider requires one)
3. Fill in the **outgoing mail (SMTP)** fields:
   - **SMTP host** — your provider's outgoing mail server (e.g. `smtp.gmail.com`)
   - **SMTP port** — usually `587` or `465`
   - **Username** and **Password** — same account credentials as above
4. Set the **default from address** — the address your delegate sends mail from.
5. Set the **default to address** — where replies go when no other address is obvious (typically your own email).
6. Click **Save**.

Once saved, your delegate starts checking the inbox automatically and will respond to any new messages it finds.

## Filtering incoming mail

By default, your delegate processes every email that arrives in the inbox. If you're worried about spam or unintended messages triggering the delegate, you can enable the **receiving filter** in Settings. When the filter is on, only messages from approved senders are acted on — everything else is ignored.

## What happens when an email arrives

1. The delegate periodically checks the inbox for new messages.
2. It reads the message, processes your request (just like a chat message), and sends a reply.
3. Processed messages are moved out of the inbox so they aren't picked up again.

## Tips

- **Gmail users**: you'll need to enable IMAP in Gmail settings and use an [App Password](https://support.google.com/accounts/answer/185833) rather than your regular password.
- **Fastmail**: works out of the box with standard IMAP/SMTP credentials.
- Keep the delegate's email address private — anyone who can email it can interact with your assistant.

---

## Technical details

- **Receiver**: `src/emailReceiver.ts` and `src/emailPoller.ts` connect via the `imap-simple` library, poll the inbox on a configurable interval, and parse messages with `mailparser` before dispatching them into the agent.
- **Sender**: `src/email.ts` uses `nodemailer` to send outbound mail over SMTP.
- **State tracking**: `src/emailState.ts` records which IMAP UIDs have already been processed so a message is never handled twice across polling cycles.
- **Processed mailbox**: the `EMAIL_PROCESSED_MAILBOX` setting controls which folder processed messages are moved into (e.g. `INBOX.Processed`).
- **Sending restriction**: setting `EMAIL_SENDING_RESTRICTED` to `true` limits outbound mail to an allow-listed set of recipients.
