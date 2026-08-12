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

This starts the app on port `8081`. Put a reverse proxy (nginx, Caddy) in front and point your domain at it. The Compose file uses a named `delegate1-runtime-data` volume mounted at `/app/runtime-data`; back up that volume to keep conversation history, memories, notes, and configuration.

**Environment variables** are passed via `.env` (see [Reference → Env Vars](../../reference/env-vars/)). The `RUNTIME_DATA_DIR` env var controls where the data volume is mounted inside the container (defaults to `/app/runtime-data`).

**Two Docker configurations:**

| File | Use |
|---|---|
| `docker-compose.browser.yml` + `Dockerfile.browser` | Standard deployment — includes browser automation (Chromium + VNC). Use this. |
| No separate base Dockerfile | The browser image is the only shipped Dockerfile; it includes everything. |

## CI/CD (automated deploys from GitHub)

Production uses two GitHub Actions workflows:

- `.github/workflows/publish.yml` runs on pushes to `main`. It writes build metadata, builds `Dockerfile.browser` for `linux/amd64`, and pushes `ghcr.io/adamd9/delegate1:latest` plus an immutable full-commit-SHA tag.
- `.github/workflows/deploy-azure.yml` runs only after that publish workflow succeeds. It authenticates to Azure, points `hk-api-drop37` at the exact SHA image, and restarts the App Service.

The immutable tag is important: restarting an App Service pinned to `latest` can reuse a cached image. Production identity can be checked with `/build-info.json` and Azure's configured container image; liveness is available at `/health`.

This CI/CD setup is specific to the author's Azure App Service deployment and is provided as a reference — you can adapt it for your own cloud platform.

## Mounted database safety

The production runtime volume is Azure Files backed. Keep `SQLITE_JOURNAL_MODE=DELETE`; do not enable WAL on Azure Files or another SMB mount. WAL's shared-memory coordination is not safe there and can corrupt the database.

After deployment or recovery, verify the active database reports `delete` and `ok` for `PRAGMA journal_mode` and `PRAGMA quick_check`, and that no persistent `assistant.sqlite-wal` or `assistant.sqlite-shm` files exist. See [Runtime data](../runtime-data/) for backup guidance.

## Production logs

```bash
scripts/hk_app_logs.sh ps                 # process status
scripts/hk_app_logs.sh logs --lines 500
scripts/hk_app_logs.sh tail
```

Requires Azure CLI + `az login`. These scripts target the author's Azure App Service instance.

