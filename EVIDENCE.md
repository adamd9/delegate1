# EVIDENCE

| Claim | Why it matters | Source | Quote ≤30w | Confidence |
|---|---|---|---|---|
| Sessions, runs, steps, artifacts form core TF | Defines schema and instrumentation points | thought-flow/thought-flow.md | “Sessions… Runs… Steps… Artifacts… Together, these form a ThoughtFlow.” | 0.95 |
| Text chat is v1 scope; each user message = run | Narrows instrumented code paths to `session/chat.ts` | QUESTIONS.md (answers) | “only `chat` text flow… each user message → new run” | 0.95 |
| JSON schema “as-is” for v1 | Locks data model to implement | thought-flow/thought-flow.md; QUESTIONS.md | “Adopt… as-is for v1” | 0.95 |
| Need simple file-based storage | Guides persistence choice (JSON/JSONL) | QUESTIONS.md | “some sort of basic storage db, file based or something simple” | 0.9 |
| Generate D2 on session end (background) | Post-session rendering step | QUESTIONS.md; thoughtflow-runs.d2 examples | “generate the d2s… once a session is done” | 0.8 |
| Track originating prompt → child responses | Requires ID/linkage fields | QUESTIONS.md | “track the originating prompt and its child responses” | 0.9 |
