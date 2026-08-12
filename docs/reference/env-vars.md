---
title: Environment variables
parent: Reference
nav_order: 1
---

# Environment variables

Settings-backed keys can be set in `.env` or in the in-app config store (via `/settings.html`); the config store is checked first. Bootstrap and low-level storage/context-policy keys are read directly from `process.env`.

## Bootstrap (read directly from `process.env`)

| Key | Default | Purpose |
|---|---|---|
| `PORT` | `8081` | HTTP listen port |
| `ADMIN_PASSWORD` | — | Admin password. If unset, install flow asks for one. |
| `RUNTIME_DATA_DIR` | `./runtime-data` | Where persisted state lives |
| `SQLITE_JOURNAL_MODE` | automatic | Force `WAL` or `DELETE`. Defaults to `WAL` locally and `DELETE` whenever `RUNTIME_DATA_DIR` is set. Keep Azure Files/SMB mounts on `DELETE`. |
| `RESPONSES_COMPACT_THRESHOLD_TOKENS` | `120000` | Token threshold sent to official Responses API compaction |
| `CONTEXT_CAPSULE_TRIGGER_TOKENS` | `24000` | Input-token threshold for refreshing the durable continuity capsule |
| `CONTEXT_CAPSULE_SOURCE_TURNS` | `40` | Maximum recent user/assistant turns supplied to capsule generation |
| `CONTEXT_RECENT_TURNS` | `8` | Maximum post-capsule turns included verbatim when continuity context is injected |
| `REALTIME_CONTEXT_RETENTION_RATIO` | `0.8` | Fraction of recent Realtime context retained when truncation occurs; must be greater than 0 and less than 1 |
| `LEDGER_DEBUG` | unset | Verbose event-ledger logging |
| `FRONTEND_URL` | `http://localhost:8081` | Used by the startup notification script |
| `CALL_MY_PHONE_ENDPOINT` | — | Optional startup notification webhook |
| `CALL_MY_PHONE_SECRET` | — | Auth for the notification webhook |
| `STARTUP_NOTIFY_MESSAGE` | — | Message sent on startup |

## Configurable via Settings UI

### OpenAI

| Key | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required for all model calls |
| `DELEGATE_TTS_MODEL` | Override TTS model |
| `DELEGATE_VOICE_SPEED` | Unified voice speed multiplier for realtime voice + walkie TTS |
| `REALTIME_MODEL` | Override realtime voice model |
| `REALTIME_VOICE` | Override realtime voice |
| `DELEGATE_MAX_AUDIO_BYTES` | Cap on per-message audio size |
| `SESSION_HISTORY_LIMIT` | Number of technical conversation records hydrated into browser history (1-50, default 3); does not prune the event ledger or set model context size |
| `SESSION_IDLE_TIMEOUT_MINUTES` | Checkpoint and collapse the current activity span after an idle period; the conversation remains resumable (0 disables) |
| `TIMEZONE` | Timezone string used in agent prompts |

### Twilio

| Key | Purpose |
|---|---|
| `PUBLIC_URL` | HTTPS URL where Twilio reaches the server (`/twiml`, `/sms`) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Default Twilio account |
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | API key auth for outbound REST |
| `TWILIO_TWIML_APP_SID` | Used by `npm run script:update-app` |
| `TWILIO_SMS_ACCOUNT_SID`, `TWILIO_SMS_AUTH_TOKEN` | Optional SMS-only account |
| `TWILIO_MESSAGING_SERVICE_SID` | Messaging Service to send from |
| `TWILIO_SMS_DEFAULT_TO` | Fallback destination |

### Email

| Key | Purpose |
|---|---|
| `EMAIL_IMAP_HOST` / `EMAIL_IMAP_PORT` / `EMAIL_IMAP_TLS` | IMAP server |
| `EMAIL_IMAP_USER` / `EMAIL_IMAP_PASSWORD` | IMAP login |
| `EMAIL_PROCESSED_MAILBOX` | Where to move processed messages |
| `EMAIL_RECEIVING_FILTER_ENABLED` | Enable inbound allow-list |
| `EMAIL_SMTP_HOST` / `EMAIL_SMTP_PORT` | SMTP server |
| `EMAIL_SMTP_USER` / `EMAIL_SMTP_PASS` | SMTP login |
| `EMAIL_DEFAULT_FROM` / `EMAIL_DEFAULT_TO` | Default addresses |
| `EMAIL_SENDING_RESTRICTED` | Restrict outbound to allow-list |

### Memory

Adaptive memory is configured through the in-app Memory settings and `runtime-data/memory-config.json`. There are no dedicated memory environment variables.

### Browser agent

| Key | Purpose |
|---|---|
| `COPILOT_GITHUB_TOKEN` | Primary token used for Copilot browser tasks (set via Settings -> Copilot + Browser Control) |
| `BROWSER_ENABLED` | Optional explicit override; `false` force-disables browser stack even if token is present |
| `COPILOT_REMOTE_REPO` | Remote repo Copilot CLI should operate on |
| `COPILOT_TIMEOUT_MS` | Per-task timeout |
| `CODEX_CLI` | Path or flag for Codex CLI integration |
| `VNC_PASSWORD` | Optional legacy override for internal VNC credential (normally generated in-process) |

### GitHub tools

| Key | Purpose |
|---|---|
| `GITHUB_PAT` | Token for GitHub repo/issue tools (separate from Copilot token) |

### Misc

| Key | Purpose |
|---|---|
| `DEEPGRAM_API_KEY` | Used by `/deepgram/token` for dev voice tests |
| `HTTPS_PROXY` | Outbound proxy |
| `DOCKER` | Set by container runtime; tweaks defaults |
| `ITEMS_DEBUG` | Verbose item logging |
| `_session_secret` | Express session secret (auto-generated; do not set manually) |
| `admin_password_hash` | Bcrypt hash of admin password (set by install flow) |
