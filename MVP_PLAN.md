# MVP_PLAN

## Phase 1 — Emitter + IDs (S)
- Create `websocket-server/src/observability/thoughtflow.ts`: emitter API
  - startSession(), endSession(), startRun(input), addStep(step), linkResponseIds(), persist()
- Wire into `session/chat.ts`: on user message, Responses request/response, tool exec, assistant output, cancel.

## Phase 2 — Persistence (S)
- File adapter writing `<session_id>.jsonl` under `websocket-server/thoughtflow/`.
- Safe, non-blocking writes; swallow errors, log warn.

## Phase 3 — Finalize & D2 (M)
- Implement `endSession()` to write session-summary JSON and generate per-session D2 from accumulated JSON.
- Background task; no UI yet. Expose a minimal internal trigger (e.g., `/session/end` existing pattern) but do not document.

## Phase 4 — Hardening (S)
- ID stability, error paths, cancellations.
- Rotation/cleanup of old sessions (basic).

## Phase 5 — V2 UI Finalize Button (S)
- Webapp: add a "Session end" button (top bar) that sends a WS control message `{ type: "session.end" }` over the existing logs socket.
- Backend: in `websocket-server/src/session/logs.ts` and/or `chat.ts`, handle `session.end` by calling `endSession()` which flushes JSONL, writes consolidated JSON, and generates D2.
- No server restart; no new HTTP endpoints required.

Estimates: Phase1 S, Phase2 S, Phase3 M, Phase4 S.
