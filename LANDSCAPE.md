# LANDSCAPE

- Prior art in repo
  - `websocket-server/src/session/chat.ts`: central text flow; natural hooks for run/step.
  - `thought-flow/*.d2` and `thought-flow.md`: desired end-state structure and visuals.
- Gaps
  - No structured session/run/step JSON yet.
  - No persistence for TF; only ad-hoc logs and canvas.
  - No session-end signal.
- Risks
  - Over-instrumentation increasing latency.
  - ID/link consistency across async tool calls.
  - File growth and rotation.
- Open debates
  - Step granularity (split request vs response vs follow-up calls).
  - D2 autogen scope for v1.
