# AGENTS

## Project summary
Delegate 1 is a single-session, multi-channel AI assistant (text, voice, phone) built around a backend-managed conversation thread. The repo is a Node/TS monorepo with a Next.js webapp and an Express/WebSocket backend, plus Twilio helper scripts.

## Repo map
- `webapp/`: Next.js frontend UI.
- `websocket-server/`: Express/WebSocket backend, session management, OpenAI Realtime, Twilio integration.
- `scripts/`: Twilio and debugging utilities.
- `tests/`: Playwright E2E tests.
- `docs/`: Architecture notes and thought-flow diagrams.

## Local development
- Install deps: `npm run install:all`
- Dev (frontend + backend): `npm run dev`
- Backend only: `npm run backend:dev`
- Frontend only: `npm run frontend:dev`
- Build: `npm run build`
- Note: never start or restart dev servers here; ask the user to do it.

## Deployment (GitHub Actions)
- Trigger: pushes to any branch; main targets prod domains, other branches target dev domains.
- Workflow: `.github/workflows/deploy.yml`.
- Artifacts: frontend `webapp/.next` + `webapp/public` + `webapp/package.json`; backend `websocket-server/dist` + `websocket-server/package.json`.
- Dispatch: `adamd9/docker-server-dev` repo event `deploy-hk` with frontend/backend domains.
- Health checks: waits ~5 minutes, then polls `https://<api_domain>/public-url` and `https://<domain>/`.

## Deployment runtime (Docker)
- Frontend container: copies artifact into `/app/hk/webapp`, installs prod deps, runs `npm run start`.
- Backend container: copies artifact into `/app/hk/websocket-server`, installs prod deps, runs `npm run start`.
- Backend mounts a runtime-data volume; `RUNTIME_DATA_DIR` should point to that mount.

## Production logs
- Use `scripts/published_app_logs.sh` to fetch Docker logs from the published prod/dev apps (requires a configured `.env.published_app_logs`).

## Environment/config
- `websocket-server/.env`: `OPENAI_API_KEY`, Twilio creds, `PUBLIC_URL` for webhook/ngrok.
- `webapp/.env`: frontend env as needed.
- Runtime data default: `websocket-server/runtime-data` (override with `RUNTIME_DATA_DIR`).

## Tests
- E2E: `npm run test:e2e` (requires backend running and valid OpenAI key).
