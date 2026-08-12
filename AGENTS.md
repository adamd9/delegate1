# AGENTS

## Project summary
Delegate 1 is a single-session, multi-channel AI assistant (text, voice, phone) built around a backend-managed conversation thread. The repo is a Node/TypeScript app with a vanilla HTML/JavaScript frontend served by an Express/WebSocket backend, plus Twilio helper scripts.

## Repo map
- `src/`: Express/WebSocket backend source.
- `client/`: Vanilla JS frontend (served as static files by Express).
- `scripts/`: Twilio and debugging utilities.
- `tests/`: plain-assert unit tests and Playwright E2E tests.
- `docs/`: Architecture notes and thought-flow diagrams.

## Local development
- Install deps: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`

## Deployment (GitHub Actions)
- Trigger: pushes to `main` (or manual workflow dispatch).
- `.github/workflows/publish.yml` writes `client/build-info.json`, builds `Dockerfile.browser` for `linux/amd64`, and pushes both `latest` and the immutable commit SHA to GHCR.
- `.github/workflows/deploy-azure.yml` runs only after a successful publish, points Azure App Service `hk-api-drop37` at the exact SHA tag, and restarts the app.
- The deployed image contains the compiled `dist/` backend and the vanilla `client/` frontend.

## Deployment runtime (Docker)
- A single container runs `node dist/server.js` from `/app` and Express serves `client/` at the root URL.
- The container mounts persistent runtime data at `/app/runtime-data` and sets `RUNTIME_DATA_DIR` to that path.
- Mounted production SQLite must use rollback `DELETE` journaling, not WAL; Azure Files/SMB does not provide WAL-safe shared-memory semantics.

## Production logs
- Use `scripts/hk_app_logs.sh` to fetch Azure App Service logs for the production app (hk.drop37.com). Requires `az login` (Azure CLI). Commands: `ps`, `logs [--lines N]`, `tail`.

## Environment/config
- Root `.env`: `OPENAI_API_KEY`, Twilio credentials, `PUBLIC_URL`, and other runtime configuration.
- Runtime data default: `runtime-data/` (override with `RUNTIME_DATA_DIR`).

## Tests
- E2E: `npm run test:e2e` (requires backend running and valid OpenAI key).

## User preference
- For natural-language interpretation tasks (query intent, fuzzy retrieval, semantic ranking, summarization), prefer model-mediated implementations over hardcoded regex/keyword heuristics.
- Keep deterministic code for validation, limits, safety, and fallback behavior, but do not present brittle pattern matching as "natural language" capability.
