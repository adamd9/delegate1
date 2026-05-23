---
title: Deployment
parent: Operations
nav_order: 1
---

# Deployment

## Deploying with Docker (recommended)

Delegate 1 ships as a Docker image. The standard deployment path is any cloud server (VPS, VM, managed container platform) with Docker installed.

**Quick deploy on a fresh server:**

```bash
git clone https://github.com/adamd9/delegate1.git
cd delegate1
cp .env.example .env
# edit .env with your keys
docker compose -f docker-compose.browser.yml up -d
```

This starts the app on port `8081`. Put a reverse proxy (nginx, Caddy) in front and point your domain at it. Data persists in `./local-volumes/runtime-data` — back up that directory to keep your notes and memories.

**Environment variables** are passed via `.env` (see [Reference → Env Vars](../../reference/env-vars/)). The `RUNTIME_DATA_DIR` env var controls where the data volume is mounted inside the container (defaults to `/app/runtime-data`).

**Two Docker configurations:**

| File | Use |
|---|---|
| `docker-compose.browser.yml` + `Dockerfile.browser` | Standard deployment — includes browser automation (Chromium + VNC). Use this. |
| No separate base Dockerfile | The browser image is the only shipped Dockerfile; it includes everything. |

## CI/CD (automated deploys from GitHub)

The project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) for automated deploys on push:

- Push to `main` → production domains
- Push to any other branch → dev domains

The job builds TypeScript to `dist/`, then dispatches a `repository_dispatch` event to a separate Docker host repo (`adamd9/docker-server-dev`), which builds and rolls out the image. A health check polls `https://<api_domain>/public-url` for ~5 minutes after dispatch.

This CI/CD setup is specific to the author's Azure App Service deployment and is provided as a reference — you can adapt it for your own cloud platform.

## Production logs

```bash
scripts/hk_app_logs.sh ps                 # process status
scripts/hk_app_logs.sh logs --lines 500
scripts/hk_app_logs.sh tail
```

Requires Azure CLI + `az login`. These scripts target the author's Azure App Service instance.

