# BRIEF — ThoughtFlow v1

- Problem
  - Hard to debug/reflect on chat agent behavior; logs lack structure.
- Goals
  - Capture session/run/step JSON for text chat.
  - Persist to simple file storage.
  - Optionally emit deltas to existing logs stream.
  - Generate D2 files on session end (no diagrams yet).
- Non-goals
  - Voice/SMS flows, dashboards, real-time UI panel, external endpoints.
- User stories
  - As a dev, I can inspect a completed session’s TF JSON and D2 to understand what happened.
- Acceptance criteria
  - New sessions get `session_id`; each user message creates a `run` with steps covering user message, responses API, tool calls, assistant output, cancellations.
  - TF persisted to file; D2 files generated on session end.
  - Chat behavior unaffected on TF write failure.
- Success metrics (qualitative v1)
  - Reduced time-to-diagnose common issues during local debugging.
