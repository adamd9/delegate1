---
title: Operations
nav_order: 4
has_children: true
permalink: /operations/
---

# Operations

Guides for running, deploying, and maintaining Delegate 1.

## [Deployment](deployment/)

How to deploy Delegate 1 to a cloud server using Docker. Covers the standard `docker compose` setup, environment variable injection, reverse proxy configuration, and the persistent data volume. Also documents the GitHub Actions CI/CD pipeline used for automated deploys. **Start here if you're putting your delegate online.**

## [Runtime data](runtime-data/)

Everything Delegate 1 persists between restarts lives in one directory (`runtime-data/` by default, or `$RUNTIME_DATA_DIR`). This page maps out that directory: where notes, memories, MCP config, voice presets, adaptations, and the SQLite database live. Essential reading if you're mounting a volume, taking a backup, or migrating to a new host.

## [Testing](testing/)

How to run the three test suites: Playwright end-to-end tests (require a live server and a valid OpenAI key), unit tests (plain Node assert, no framework), and voice pipeline tests. Explains what each suite covers and how to run a single test by name.

## [Logging](logging/)

The in-process log buffer, the `/logs` viewer in the UI, and the production log scripts (`scripts/hk_app_logs.sh` for Azure App Service). Useful when you're debugging a failed tool call or tracing why the agent responded the way it did.
