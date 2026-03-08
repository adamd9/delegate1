# Consolidation Plan: Single-Process Monolith

## Goal

Eliminate the separate frontend/backend architecture. The current repo runs two processes (Next.js on `:3000`, Express on `:8081`) and deploys two containers. The target is one Node.js process, one build step, one container, zero frontend framework.

## Principle

Keep the app fully working at the end of every phase before starting the next. Each phase is independently shippable. No phase requires the previous one's refactoring to be complete.

---

## Phase 1 — Move API Routes: Next.js → Express

**Scope:** 5 tiny proxy routes move out of `webapp/app/api/` into the Express backend. Nothing else changes. The Next.js app continues to run on `:3000`.

**Routes to migrate into Express:**
- `/api/session` — OpenAI realtime session token proxy
- `/api/twilio` — Twilio credentials check
- `/api/deepgram/*` — Deepgram auth proxy
- `/api/backend-logs/*` — backend log fetching (already a backend concern; update fetch URL in frontend)
- `/api/backend-url` — **eliminated entirely**; frontend derives the WS URL from `window.location` instead

Frontend `fetch()` calls to `/api/*` get updated to point at `:8081` directly.

**Why:** This drains all server-side logic from Next.js, making it safe to static-export in Phase 2.

**Files touched:**
- `websocket-server/src/server.ts` — add migrated routes
- `webapp/app/api/` — delete migrated route files
- Frontend components that call `/api/*` — update fetch URLs

**Test:** App works normally on the existing `:3000`/`:8081` split. All `/api/*` calls now resolve via `:8081`.

---

## Phase 2 — Static Export + Express Serves the Frontend

**Scope:** A Next.js config change and one line in Express. Zero React or JS logic changes.

1. `webapp/next.config.mjs`: change `output: 'standalone'` → `output: 'export'`
   - `next build` now produces static files in `webapp/out/` instead of a Node.js server
2. `websocket-server/src/server.ts`: add `app.use(express.static('../webapp/out'))`
3. Build Next.js once: `cd webapp && next build`
4. Stop running the Next.js dev server — everything is now on `:8081`

**Why:** Next.js becomes a build tool only, not a runtime server. The existing React app acts as an integration test for the monolith: if it works, the consolidation is sound before any UI code is touched.

**Files touched:**
- `webapp/next.config.mjs`
- `websocket-server/src/server.ts`

**Test:** Browse to `http://localhost:8081/` — same app, same UI, fully functional. Single port.

---

## Phase 3 — Deploy as Single Container

**Scope:** CI/CD pipeline only. No runtime code changes.

- Remove the `build-frontend` parallel job from `deploy.yml`; fold it into the single build step
- Build sequence: `cd webapp && next build`, then `cd websocket-server && npm run build`, bundle `webapp/out/` into the backend artifact alongside `dist/`
- Remove the separate frontend container from the Docker dispatch payload
- Remove the `wait-frontend-health` job (one health check only: `/public-url`)
- Update `playwright.config.ts` base URL to `:8081`
- Update `package.json` root scripts: remove `frontend:*`, remove `concurrently`, simplify `dev`/`build`/`start` to point at `websocket-server` only

**Files touched:**
- `.github/workflows/deploy.yml`
- `package.json` (root)
- `websocket-server/package.json` (build script: copy `../webapp/out` → `dist/client`)
- `playwright.config.ts`
- `AGENTS.md`

**Test:** Push to branch → single container deploys → health check passes → full E2E suite passes on `:8081`.

This is the **end of the consolidation work.** The app is a production monolith. Phases 4+ are optional quality improvements with no deadline pressure.

---

## Phase 4 — Vanilla JS Rewrite (iterative, optional)

Only begin once the monolith is stable in production. Work through sub-phases in separate coding sessions, each independently shippable.

The strategy: new `client/` directory inside `websocket-server/` coexists with `webapp/out/` during transition. Switch Express static serving from `webapp/out` to `client/` when ready. Delete `webapp/` entirely when all views are ported.

### 4a — Core Infrastructure
- **State store** (`client/js/state.js`) — pub/sub replacing `TranscriptContext`. 8 mutation methods + subscriber notifications. Reference: `webapp/contexts/TranscriptContext.tsx`
- **WebSocket manager** (`client/js/ws.js`) — connect to `/chat` (same origin), auto-reconnect, send/receive. Reference: `webapp/components/call-interface.tsx`
- **Event processor** (`client/js/events.js`) — port of `webapp/lib/handle-enhanced-realtime-event.ts` (~550 lines, 25+ event types). Highest complexity: voice dedup, replay namespacing, function call dedup, metadata tracking.
- **Hash router** (`client/js/router.js`) — maps `#/path` to render functions
- **DOM utilities** (`client/js/render.js`) — tagged template literals, `html → DOM`, minimal helpers

### 4b — Main Chat View
- `client/index.html` — app shell: top bar, main content area, canvas sidebar. Semantic HTML, `<script type="module">`.
- `client/js/views/top-bar.js` — nav links, responsive hamburger (vanilla JS toggle), connection status indicator
- `client/js/views/chat.js` — composes transcript + input, manages WS lifecycle
- `client/js/views/transcript.js` — port of `enhanced-transcript.tsx` (~500 lines). Sort by `createdAtMs`, history separator, message bubbles vs breadcrumbs, streaming delta updates (mutate existing DOM nodes), copy-to-clipboard, canvas link detection.
- `client/js/views/chat-input.js` — auto-resize textarea, Enter to send, Shift+Enter for newlines, cancel button
- `client/css/styles.css` — all Tailwind utility classes translated to plain CSS. Custom properties for theming, responsive breakpoints.

### 4c — Secondary Views (one per session)
- **Canvas preview** — right sidebar, iframe artifact display
- **Browser voice** — AudioContext mic capture (48kHz→24kHz resample→Int16→base64→WS), playback queue. The audio pipeline in `webapp/app/voice-direct/page.tsx` is already vanilla-compatible.
- **Twilio voice** — Twilio Voice SDK loaded from CDN (only external browser dependency). Call management, DTMF.
- **Settings / Adaptations / MCP config** — forms that fetch + save to existing backend endpoints
- **Logs viewer** — fetch from `/logs`, auto-scroll display
- **ThoughtFlow** — D2 diagram visualization
- **Function calls panel + setup status indicator**

### 4d — Delete `webapp/`
- Remove `webapp/` directory entirely
- Remove `webapp` from root workspace
- Update build to compile only `websocket-server/`
- Update `AGENTS.md`

---

## Risk Profile

| Phase | Risk | Rollback |
|---|---|---|
| 1 — Move API routes | Minimal — small Express additions, fetch URL updates | Remove 5 routes, revert fetch calls |
| 2 — Static export | Low — config change + one `express.static` line | Revert `next.config.mjs`, remove static line |
| 3 — Single container | Medium — CI/CD only, no runtime code changes | Revert `deploy.yml` |
| 4 — Vanilla JS rewrite | High — large new code, but isolated in `client/`; `webapp/out/` remains as fallback | Delete `client/`, re-enable `webapp/out/` serving |

---

## Key Decisions

- **ES modules in browser, no bundler** — `<script type="module">` + native `import`. No minification (acceptable for device deployment where network latency isn't a bottleneck).
- **Hash routing (`#/path`)** — avoids server-side catch-all complexity entirely.
- **Same-origin WebSocket** — since frontend and backend are the same server, WS connects to `window.location.host`. No CORS config required. `/api/backend-url` is eliminated.
- **Twilio Voice SDK from CDN** — the only remaining external browser dependency.
- **`client/` inside `websocket-server/`** — one package, one process, one place.
- **All features preserved** — nothing is cut; every current page/feature gets a vanilla JS equivalent in Phase 4.
