# AGENTS

## Project summary
Delegate 1 is a single-session, multi-channel AI assistant (text, voice, phone) built around a backend-managed conversation thread. The repo is a Node/TS monorepo with a Next.js webapp and an Express/WebSocket backend, plus Twilio helper scripts.

## Repo map
- `src/`: Express/WebSocket backend source.
- `client/`: Vanilla JS frontend (served as static files by Express).
- `scripts/`: Twilio and debugging utilities.
- `tests/`: Playwright E2E tests.
- `docs/`: Architecture notes and thought-flow diagrams.

## Local development
- Install deps: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Note: never start or restart dev servers here; ask the user to do it.

## Deployment (GitHub Actions)
- Trigger: pushes to any branch; main targets prod domains, other branches target dev domains.
- Workflow: `.github/workflows/deploy.yml`.
- Single build job: builds webapp static export (`next build` → `out/`), copies into backend as `websocket-server/webapp-out/`, then compiles backend TypeScript.
- Artifact: `websocket-server/dist` + `websocket-server/webapp-out` + `websocket-server/package.json`.
- Dispatch: `adamd9/docker-server-dev` repo event `deploy-hk` with frontend/backend domains.
- Health check: waits ~5 minutes, then polls `https://<api_domain>/public-url`.

## Deployment runtime (Docker)
- Single backend container: copies artifact into `/app/hk/websocket-server`, installs prod deps, runs `npm run start`.
- Express serves the static frontend from `websocket-server/webapp-out/` at the root URL.
- Backend mounts a runtime-data volume; `RUNTIME_DATA_DIR` should point to that mount.

## Production logs
- Use `scripts/published_app_logs.sh` to fetch Docker logs from the published prod/dev apps (requires a configured `.env.published_app_logs`).

## Environment/config
- `websocket-server/.env`: `OPENAI_API_KEY`, Twilio creds, `PUBLIC_URL` for webhook/ngrok.
- `webapp/.env`: frontend env as needed.
- Runtime data default: `websocket-server/runtime-data` (override with `RUNTIME_DATA_DIR`).

## Tests
- E2E: `npm run test:e2e` (requires backend running and valid OpenAI key).
