# ThoughtFlow Instrumentation — Clarifying Questions

These questions will lock scope and constraints before we design/store/emit ThoughtFlow events in `websocket-server/`.

## Core & Success
1) What primary problem should ThoughtFlow solve first: human debugging, auditability, analytics, or model self-reflection? Rank 1–4.
1. human debugging
2. model self-reflection
no other priorities at this stage

2) What are success metrics for v1 (e.g., time-to-diagnose issue ↓, % tool-call traces captured, diagram generation speed, storage overhead)?
NA

## Scope & Boundaries
3) v1 coverage: only `chat` text flow, or also `call` (Twilio voice) and `/sms`? If phased, what must be included in v1 vs v2?
1. only `chat` text flow

4) Define a “run” boundary precisely for text: each user message → new run, or batching across clarifying turns? Any server-triggered runs?
1. each user message → new run

we need to define the end of a session as well, which would "roughly" translate to end of a converesation. We should add a minimal UI action to the web app to "end" a conversation, so we can kick off generating a full session notation.

## Schema & IDs
5) Adopt the JSON schema in `thought-flow/thought-flow.md` as-is for v1? Any required fields to add (latency, error, tool origin, response IDs)?
as is for v1

6) ID policy: `session_id`, `run_id`, `step_id` formats and uniqueness. Should we embed OpenAI Responses `previous_response_id` links in steps?
def session and run id and step id. step id might get complicated so pause to clarify if things are unclear. beyond that, the other thing I want to be able to track is the originating prompt and it's child responses (which could be a hiearchy) as I want to be able to trace the input prompts to the potential downstream impacts (which canb e a little non-deterministic)

## Storage, Retention, Access
7) Where should we persist ThoughtFlow: in-memory ring buffer only, file-backed logs, or pluggable adapter (e.g., JSONL, SQLite, S3)? Retention window?
Think we need some sort of basic storage db, file based or something simple. 

8) Access patterns: endpoints needed now (e.g., `GET /thoughtflow/session/:id`, `GET /thoughtflow/current`, `GET /thoughtflow/runs/:runId`, WebSocket stream)?
dont yet see a need for end points. lets focus on instrumentation and storage of the base json notation, as well as the d2 notation (but not diagram generation yet).

## Privacy, PII, Redaction
9) What data must be redacted by default (phone numbers, Twilio IDs, addresses, raw tool payloads)? Any compliance requirements (GDPR/DSR export/delete)?
NA

## Performance & Ops
10) Overhead budget: acceptable per-step logging overhead (e.g., <2 ms synchronous, async offloading OK)? Failure policy: if TF write fails, never block chat/voice, correct?
NA

## Visualization & Tooling
11) Do we need automatic D2 generation on-save, or a manual CLI (e.g., `flowgen`), and where should generated diagrams live (ignored by git)?
we hsould generate the d2s maybe as a background process once a session is done

## Integration & UI
12) What minimal UI is required now: just feed `webapp/` LogViewer with TF events, or build a new ThoughtFlow panel? If latter, basic features for v1?
none in first version, lets focus on instrumentation and sotrage of the results.

## Security & Multi-tenant
13) Any multi-tenant or auth constraints for `/thoughtflow` endpoints/streams? Should they mirror current `/logs` exposure level?
NA
