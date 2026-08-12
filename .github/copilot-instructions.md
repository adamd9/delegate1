# Copilot Instructions

## Project Summary

Delegate 1 is a single-session, multi-channel AI assistant (text, voice, phone) built around a backend-managed conversation thread. It's a Node/TypeScript project with an Express/WebSocket backend and a vanilla JS frontend served as static files.

## Commands

- **Install**: `npm install`
- **Build**: `npm run build` (runs `tsc` + copies XML/config assets to `dist/`)
- **Dev**: `npm run dev` (uses `nodemon` + `ts-node`, watches `src/`)
- **Run all E2E tests**: `npm run test:e2e` (requires backend running + valid OpenAI key)
- **Run a single E2E test**: `npx @playwright/test@1.55.0 test tests/e2e/<filename>.spec.ts`
- **Run a single test by name**: `npx @playwright/test@1.55.0 test -g "test name pattern"`
- **Run unit tests**: `npm run test:unit` (runs `ts-node tests/unit/memory-deduplicator.test.ts`)
- **Run context policy tests**: `npm run test:context-policy`
- **Run checkpoint/continuity tests**: `npm run test:checkpoint`
- **Run voice tests**: `npm run test:voice` (runs `ts-node src/voice/voicePipeline.test.ts`)

Unit tests use plain Node `assert` — there is no test framework (no Jest/Vitest). There is no linter configured.

## Architecture

### Single-Session Singleton

The entire app shares ONE mutable `session` object (`src/sessionSingleton.ts`, `src/session/state.ts`). All channels (text chat, voice, phone, SMS, email) read and write to this singleton. There is no per-request or per-user isolation. Only one voice/call connection can be active at a time; multiple text chat WebSocket clients are allowed.

### Single Base Agent

A single **base agent** handles every turn directly, calling tools as needed (local handlers, MCP tools, or `web_search` for fresh information).

- Base agent config: `src/agentConfigs/baseAgentConfig.ts`
- Agent registry: `src/agentConfigs/index.ts`

The `web_search` tool (`src/tools/handlers/web-search.ts`) wraps a single OpenAI Responses API call with the builtin web_search tool enabled. The wrapping exists because the Realtime API used by voice only accepts function tools, not OpenAI builtin tool types — so we expose web search uniformly as a function across text and voice. The voice channel plays a hold-music pulse while the wrapped call is in flight (see `startHoldMusicLoop` in `src/session/call.ts`).

### Tool Registry

Tools are registered through a canonical registry (`src/tools/registry.ts`) with three providers:

1. **Builtin** (`src/tools/providers/builtin.ts`) — model-native tools like `web_search`
2. **Local** (`src/tools/providers/local.ts`) — handler implementations in `src/tools/handlers/`
3. **MCP** (`src/tools/providers/mcp.ts`) — remote tools discovered from MCP servers configured in `runtime-data/mcp-servers.json`

Agent access to tools is controlled by **policies** (tag-based + name-based allowlists) stored in `runtime-data/agent-policies.json`. Tools are initialized at startup in `src/tools/init.ts`.

### WebSocket Endpoints

Defined in `src/ws/attach.ts`, routing by URL path:

| Path | Handler | Purpose |
|------|---------|---------|
| `/call` | `src/session/call.ts` | Twilio phone call bridge (G.711 µ-law audio) |
| `/browser-call` | `src/session/browserCall.ts` | Browser voice (PCM16 24kHz audio) |
| `/chat` | `src/session/chat.ts` | Text chat via Responses API |

Chat protocol: client sends `{ type: 'chat.message', content }`; the server emits `chat.working`, then a completed `{ type: 'chat.response', content, conversation_id }`, followed by `chat.done`.

### Database

SQLite via `better-sqlite3` (`src/db/sqlite.ts`). Key tables: `sessions`, `conversations`, `conversation_events` (event ledger), `thoughtflow_artifacts`. Database file lives at `runtime-data/db/assistant.sqlite` (or `$RUNTIME_DATA_DIR/db/assistant.sqlite`).

Local development defaults to WAL. Any mounted runtime selected with `RUNTIME_DATA_DIR` defaults to rollback `DELETE` mode with `busy_timeout = 5000`; production Azure Files/SMB must never use WAL.

### Timeline and Model Context

The user sees one chronological relationship timeline across all channels. Technical conversation records, collapsible activity spans, and incremental checkpoints organise the durable SQLite event ledger without creating idle-time chat boundaries.

Model context is bounded separately: Responses calls use `previous_response_id` plus official compaction, Realtime sessions use retention-ratio truncation, and both protocols use a durable model-written continuity capsule plus recent verbatim turns when starting or switching context. Usage, compaction, capsule, and memory activity render as Inner Plane events.

### Runtime Data

`runtime-data/` (overridable via `RUNTIME_DATA_DIR` env var) stores all persistent non-database state: `notes.json`, `mcp-servers.json`, `agent-policies.json`, `adaptations.edits.json`, `voice-presets/`, and `thoughtflow/` observability data. Every module resolves its storage path using the same pattern:

```typescript
const dir = process.env.RUNTIME_DATA_DIR
  ? path.join(process.env.RUNTIME_DATA_DIR, 'subdir')
  : path.join(__dirname, '...', 'runtime-data', 'subdir');
```

### Memory System

The memory module (`src/memory/`) manages persistent user context across conversations. It includes the native adaptive backend, a conversation bus for real-time memory extraction, and a deduplicator (`src/memory/deduplicator.ts`) that suppresses repeated memory insertions. Memory config is managed at runtime via `runtime-data/` and the settings UI.

## Key Conventions

- **Voice interruption invariant**: Realtime turn detection uses `interrupt_response: true`; barge-in code flushes downstream playback and suppresses stale deltas rather than sending `response.cancel` or `conversation.item.truncate`.
- **`responseStartTimestamp`** tracks active audio streaming state: set on first audio delta, cleared on `response.audio.done` or truncation.
- Build copies `src/twiml.xml` and `src/config/*` to `dist/` as non-TS assets (`npm run copy-assets`).
- E2E tests run sequentially with a single Playwright worker (`workers: 1`) because the backend has a single global session. Tests reset session state via `POST /session/reset` before each test.
- The frontend in `client/` is vanilla HTML/JS (not a framework) — Express serves it as static files.

## Deployment

On pushes to `main`, `.github/workflows/publish.yml` builds `Dockerfile.browser` and publishes `latest` plus the immutable commit SHA to GHCR. After a successful publish, `.github/workflows/deploy-azure.yml` pins Azure App Service to that exact SHA and restarts it. Production logs: `scripts/hk_app_logs.sh` (requires `az login`).
