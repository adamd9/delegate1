---
title: Email
parent: Features
nav_order: 5
---

# Email

Delegate 1 has a polling IMAP receiver and a nodemailer-based sender. The agent can be addressed by email and reply by email.

## Architecture

- **Receiver** (`src/emailReceiver.ts` + `src/emailPoller.ts`) connects via `imap-simple`, polls the inbox on an interval, parses messages with `mailparser`, and dispatches them into the agent.
- **Sender** (`src/email.ts`) uses `nodemailer` to send outbound mail via SMTP.
- **State** (`src/emailState.ts`) tracks which UIDs have been processed so polls don't re-handle the same message.

## Config

All keys live in the in-app config store (Settings UI):

| Key | Purpose |
|---|---|
| `EMAIL_IMAP_HOST`, `EMAIL_IMAP_PORT`, `EMAIL_IMAP_TLS` | IMAP server |
| `EMAIL_IMAP_USER`, `EMAIL_IMAP_PASSWORD` | IMAP login |
| `EMAIL_PROCESSED_MAILBOX` | Mailbox name to move processed messages into (e.g. `INBOX.Processed`) |
| `EMAIL_RECEIVING_FILTER_ENABLED` | When `true`, only emails matching the filter rules are accepted |
| `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT` | SMTP server |
| `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASS` | SMTP login |
| `EMAIL_DEFAULT_FROM` | "From" address on outbound mail |
| `EMAIL_DEFAULT_TO` | Default destination when none is detected |
| `EMAIL_SENDING_RESTRICTED` | When `true`, restricts outbound to allow-listed recipients |

## Behaviour

- The poller runs continuously while the server is up. You'll see `[EmailPoller] Starting email polling...` in the logs.
- Processed messages are typically moved out of the inbox to avoid reprocessing.
- Outbound email goes through the `send_email` tool registered with the local provider.

## Testing locally

Use a disposable account or an alias on Gmail/Fastmail. Set the IMAP/SMTP values, send a test email to the account, and watch the logs for poll-fetch-dispatch events.
