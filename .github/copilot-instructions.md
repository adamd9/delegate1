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
- **Run voice tests**: `npm run test:voice` (runs `ts-node src/voice/voicePipeline.test.ts`)

Unit tests use plain Node `assert` — there is no test framework (no Jest/Vitest). There is no linter configured.

## Architecture

### Single-Session Singleton

The entire app shares ONE mutable `session` object (`src/sessionSingleton.ts`, `src/session/state.ts`). All channels (text chat, voice, phone, SMS, email) read and write to this singleton. There is no per-request or per-user isolation. Only one voice/call connection can be active at a time; multiple text chat WebSocket clients are allowed.

### Two-Tier Agent Model

A **base agent** handles simple queries directly and **escalates** complex tasks to a **supervisor agent** via the `getNextResponseFromSupervisor` tool call.

- Base agent config: `src/agentConfigs/baseAgentConfig.ts`
- Supervisor agent config: `src/agentConfigs/supervisorAgentConfig.ts`
- Agent registry: `src/agentConfigs/index.ts`

The supervisor runs in a loop (up to 5 iterations) using the Responses API, calling tools like `web_search`, then returns its answer to the base agent which relays it to the user.

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

Chat protocol: client sends `{ type: 'chat.message', content }`, server responds with `{ type: 'chat.response', content, conversation_id }` plus streaming deltas.

### Database

SQLite via `better-sqlite3` (`src/db/sqlite.ts`). Key tables: `sessions`, `conversations`, `conversation_events` (event ledger), `thoughtflow_artifacts`. Database file lives at `runtime-data/db/assistant.sqlite` (or `$RUNTIME_DATA_DIR/db/assistant.sqlite`).

### Runtime Data

`runtime-data/` (overridable via `RUNTIME_DATA_DIR` env var) stores all persistent non-database state: `notes.json`, `mcp-servers.json`, `agent-policies.json`, `adaptations.edits.json`, `voice-presets/`, and `thoughtflow/` observability data. Every module resolves its storage path using the same pattern:

```typescript
const dir = process.env.RUNTIME_DATA_DIR
  ? path.join(process.env.RUNTIME_DATA_DIR, 'subdir')
  : path.join(__dirname, '...', 'runtime-data', 'subdir');
```

### Memory System

The memory module (`src/memory/`) manages persistent user context across conversations. It includes an adaptive backend, Mem0 integration, a conversation bus for real-time memory extraction, and a deduplicator (`src/memory/deduplicator.ts`) that suppresses repeated memory insertions. Memory config is managed at runtime via `runtime-data/` and the settings UI.

## Key Conventions

- **Never start or restart dev servers from an AI assistant session** — always ask the user to do it.
- **Voice interruption guard**: always check `isResponseActivelyStreaming()` before calling `response.cancel` in voice/barge-in logic (`src/session/call.ts`).
- **`responseStartTimestamp`** tracks active audio streaming state: set on first audio delta, cleared on `response.audio.done` or truncation.
- Build copies `src/twiml.xml` and `src/config/*` to `dist/` as non-TS assets (`npm run copy-assets`).
- E2E tests run sequentially with a single Playwright worker (`workers: 1`) because the backend has a single global session. Tests reset session state via `POST /session/reset` before each test.
- The frontend in `client/` is vanilla HTML/JS (not a framework) — Express serves it as static files.

## Deployment

GitHub Actions workflow (`.github/workflows/deploy.yml`): pushes to `main` deploy to prod domains, other branches to dev domains. The build produces `dist/` + assets, dispatches to `adamd9/docker-server-dev` for Docker deployment. Production logs: `scripts/hk_app_logs.sh` (Azure App Service, requires `az login`).
