# DECISIONS

- Chosen approach: 1) Inline emitter + JSONL persistence
  - Rationale: Write-safety, simplicity, minimal coupling. Aligns with “file-based simple DB.”
  - What changes my mind: Strong need for single-file JSON artifacts or cross-session querying soon → choose 2 or 3.

- Scope
  - v1: text chat only, each user message = run.
  - Session end: internal API or command triggers TF finalize; UI button deferred.
  - v2: add webapp "Session end" button to emit a WS control message to finalize.

- IDs & linkage
  - `session_id = sess_<timestamp>` on first chat connection.
  - `run_id = run_<increment>` per user message.
  - `step_id = step_<runIdx>_<increment>` within run.
  - Link parent/child: record `response_parent_id` and `previous_response_id` when available.

- Artifacts
  - Base JSONL per session; D2 `.d2` per session on finalize.
  - V2 finalize trigger: logs/chat WS control `{ type: "session.end" }` from the webapp button.
