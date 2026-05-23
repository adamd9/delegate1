# Delegate 1

A single-session, multi-channel AI assistant. One conversation thread across **text chat**, **browser voice**, **phone calls (Twilio)**, **SMS**, and **email**.

📖 **[Full documentation](https://adamd9.github.io/delegate1/)** *(GitHub Pages — see [docs/](./docs))*

## Quick start

```bash
git clone https://github.com/adamd9/delegate1.git
cd delegate1
npm install
cp .env.example .env
# add OPENAI_API_KEY=... to .env
npm run dev
```

Then open <http://localhost:8081>. The first launch walks you through `/install` to set an admin password.

## What's in this repo

| Path | What |
|---|---|
| `src/` | Backend (Node + TypeScript, Express + WebSocket) |
| `client/` | Static HTML/JS frontend served by the backend |
| `runtime-data/` | Persistent state (notes, MCP config, agent policies, SQLite db) |
| `scripts/` | Twilio + debug helpers |
| `tests/` | Playwright e2e + unit tests |
| `docs/` | Jekyll docs site (this README points there for everything else) |

## Common commands

```bash
npm run dev         # development with auto-reload
npm run build       # compile TS + copy assets to dist/
npm start           # production-style run from dist/
npm run test:e2e    # Playwright end-to-end tests
npm run test:unit   # unit tests (memory deduplicator)
npm run test:voice  # voice pipeline test
```

## Documentation

Everything else — installation, configuration, every feature (phone, email, memory, MCP, agents, browser agent, thoughtflow, adaptations), deployment, API reference — lives in the docs:

- **[Getting Started](./docs/getting-started/)**
- **[Features](./docs/features/)** — one page per capability
- **[Operations](./docs/operations/)**
- **[Reference](./docs/reference/)** — env vars, endpoints, architecture

### Enabling GitHub Pages

After this PR is merged, enable the docs site:

1. **Settings → Pages** in this repo
2. **Source**: *Deploy from a branch*
3. **Branch**: `main`, folder `/docs`
4. Save — the site builds automatically (Jekyll + the `just-the-docs` remote theme).

## License

ISC
