# RISKS

- Unknowns
  - Exact mapping of OpenAI Responses objects → TF steps for edge cases.
  - Tool orchestrator emits: need consistent args/result capture without PII.
- Spikes
  - Spike 1: Instrument a single run with one tool call; verify JSONL and D2 emission.
  - Spike 2: Cancellation path: ensure TF captures `chat.canceled` and request linkage.
- Stop/Go criteria
  - Go if end-to-end JSONL and D2 for a short session are accurate and stable across 3 runs.
