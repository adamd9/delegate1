---
title: Deployment
parent: Operations
nav_order: 1
---

# Deployment

## CI/CD

The workflow at `.github/workflows/deploy.yml` runs on every push:

- Push to `main` → production domains
- Push to any other branch → dev domains

The job builds the backend (TypeScript → `dist/`, plus `npm run copy-assets`) and dispatches a `repository_dispatch` to **`adamd9/docker-server-dev`**, which builds and rolls out the Docker image.

After dispatch the workflow polls `https://<api_domain>/public-url` for ~5 minutes as a health check.

## Docker

The single backend image:

- Copies the build artifact into `/app/hk/websocket-server` (legacy path)
- `npm install --omit=dev`
- `npm run start` (which runs `node dist/server.js`)
- Serves the static frontend from `client/`
- Mounts a runtime-data volume; set `RUNTIME_DATA_DIR` to that mount

There's also a separate **browser** image (`Dockerfile.browser` + `docker-compose.browser.yml`) for the [browser agent](../../features/browser-agent/) — it bundles Chromium + a VNC server.

## Production logs

```bash
scripts/hk_app_logs.sh ps                 # process status
scripts/hk_app_logs.sh logs --lines 500
scripts/hk_app_logs.sh tail
```

Requires Azure CLI + `az login`. Production lives on Azure App Service.
