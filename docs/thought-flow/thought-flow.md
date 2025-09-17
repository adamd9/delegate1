# **Seeing the Structure: A Practical Model for ThoughtFlow in Agentic AI**

We don’t need another chat UI.
What we need is a way to **see how work actually happens** inside an agent — how user inputs, reasoning steps, and tool calls combine to produce results.

This is where **ThoughtFlow** comes in: a structured, machine- and human-readable representation of every session, every run, and every step.

---

## **1. The Core Idea**

Every agent interaction is more than just a transcript. It’s a **structured process**:

* **Sessions**: the outer container for all activity in a conversation or workflow.
* **Runs**: discrete tasks that begin with a **user input** or system trigger.
* **Steps**: the building blocks of a run — model calls, tool invocations, memory operations, and user messages.
* **Artifacts**: the inputs and outputs of steps, like raw prompts, assistant replies, tool responses, or stored values. This now includes a first-class, modifiable prompt artifact — `prompt.adaptations` — which adds developer/agent-editable guidance to the final instruction string without changing the base policy.

Core feedback loop (self‑reflection → adaptation → verification):

1. The agent produces ThoughtFlow artifacts for each run (messages, tool calls, prompt provenance, etc.).
2. A reflection process (human or model) reads the consolidated JSON, identifies opportunities to improve prompt behavior, and proposes changes to `prompt.adaptations`.
3. Changes are applied via tools (edit/enable/disable adaptation items), hot‑reloaded, and then verified in subsequent runs (the new state appears in `prompt_provenance.parts` and the consolidated JSON).

Together, these form a **ThoughtFlow**: a traceable structure the platform can use for **debugging, analysis, optimization, and even self-reflection**.

---

## **2. Entities and Relationships**

| Entity       | Purpose                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| **Session**  | Container for related runs (one conversation, one job, or one context).    |
| **Run**      | A single task starting with a user input or a trigger.                     |
| **Step**     | One atomic operation (user/assistant message, tool call/output, etc.).     |
| **Edges**    | Dependencies between steps via `depends_on` (string or string[] of step IDs). |

Notes:
- Steps are explicitly typed using an enum: `user_message`, `assistant_message`, `tool_call`, `tool_output`, `tool_error`, `generic`.
- Data created/consumed by steps (args/results/text) are kept within the step payloads; there is no separate "Artifact" entity in the current implementation.

---

## **3. Example ThoughtFlow (Production-Style)**

A simple weather interaction produces a ThoughtFlow like this:

**Session**: `sess_2025-09-02`
**Run 1** (User asks for weather)

* `chat.on_message` ("what’s the weather today?")
* `responses.request` → LLM clarifies location
* `assistant.output` ("To fetch today’s weather, I need your location...")

**Run 2** (User provides city)

* `chat.on_message` ("canberra")
* `nlp.normalize_location` → lat/long
* `tool.get_weather_from_coords` → returns `{ temp: 2°C, summary: "chilly" }`
* `assistant.output` ("In Canberra right now it’s about 2°C (very chilly).")

**Run 3** (User requests to remember)

* `chat.on_message` ("thanks, you should remember that im based in canberra")
* `responses.request` → agent asks for confirmation
* `chat.on_message` ("yes")
* `tool.mem_add` (key=user.base\_location, value=Canberra\_AU)
* `assistant.output` ("Got it — I’ll remember you’re based in Canberra...")

---

## **4. Why ThoughtFlow Matters**

### **For humans**

* **Debugging:** Stop digging through raw logs; see clear runs and steps.
* **Analysis:** Spot bottlenecks, latency spikes, or repeated tool failures.
* **Audit:** Reconstruct exactly what happened during any interaction.

### **For the agent**

* **Reflection:** Identify where reasoning or actions failed.
* **Optimization:** Detect slow steps or high-error paths automatically.
* **Memory management:** Consolidate useful artifacts, discard noise.
* **Adaptation:** Improve planning by learning from past successful flows.

---

## **5. JSON as the Source of Truth**

All ThoughtFlow visualizations are generated from a consolidated JSON representation written at session finalization. Modifiable prompt components (like `prompt.adaptations`) are discoverable directly from step entries and `prompt_provenance` — no separate catalog is required.

### **Current Consolidated JSON Shape**

```
{
  "session_id": "sess_1693660012345",
  "started_at": "2025-09-02T20:11:35.442Z",
  "ended_at": "2025-09-02T20:12:05.442Z",
  "conversations": [
    {
      "conversation_id": "conv_1",
      "channel": "text",
      "status": "completed",
      "started_at": "2025-09-02T20:11:35.500Z",
      "ended_at": "2025-09-02T20:11:40.100Z",
      "duration_ms": 4600,
      "steps": [
        {
          "step_id": "s1",
          "label": "user_message",
          "started_at": "2025-09-02T20:11:35.500Z",
          "ended_at": "2025-09-02T20:11:35.550Z",
          "duration_ms": 50,
          "payload_started": { "text": "what’s the weather today?" },
          "payload_completed": { "ok": true }
        },
        {
          "step_id": "s2",
          "label": "tool_call",
          "depends_on": "s1",
          "started_at": "2025-09-02T20:11:36.000Z",
          "ended_at": "2025-09-02T20:11:36.200Z",
          "duration_ms": 200,
          "payload_started": { "name": "get_weather", "args": { "city": "Canberra" } },
          "payload_completed": { "ok": true }
        },
        {
          "step_id": "s2_out",
          "label": "tool_output",
          "depends_on": "s2",
          "payload_started": { },
          "payload_completed": { "result": { "tempC": 13, "conditions": "Showers" } }
        },
        {
          "step_id": "snp_policy_ab12cd34",
          "label": "policy.snapshot",
          "started_at": "2025-09-02T20:11:36.250Z",
          "payload_started": {
            "version": "ab12cd34",
            "produced_at": 1693660296442,
            "content_preview": "You are a fast voice AI assistant..."
          },
          "ended_at": "2025-09-02T20:11:36.251Z",
          "duration_ms": 1
        },
        {
          "step_id": "snp_tools_ef56gh78",
          "label": "tool.schemas.snapshot",
          "started_at": "2025-09-02T20:11:36.251Z",
          "payload_started": {
            "version": "ef56gh78",
            "count": 3,
            "names": ["send_canvas", "send_sms", "get_note"],
            "schemas_preview": "[ { \"name\": \"send_canvas\" }, { \"name\": \"send_sms\" } ]"
          },
          "ended_at": "2025-09-02T20:11:36.251Z",
          "duration_ms": 0
        },
        {
          "step_id": "snp_context_req_1693660296500",
          "label": "context.preamble",
          "started_at": "2025-09-02T20:11:36.252Z",
          "payload_started": {
            "context": { "channel": "text", "currentTime": "02/09/2025 20:11:36", "timeZone": "Australia/Sydney" }
          },
          "ended_at": "2025-09-02T20:11:36.252Z",
          "duration_ms": 0
        },
        {
          "step_id": "s_adn",
          "label": "prompt.adaptations",
          "payload_started": { },
          "payload_completed": {
            "included_ids": ["adn.safety.general"],
            "content_preview": "Safety: Never disclose secrets...",
            "content_length": 34,
            "scope": { "agent": "base", "channel": "text" },
            "modifiable": true
          }
        },
        {
          "step_id": "s_llm",
          "label": "assistant_call",
          "depends_on": [
            "s1",
            "snp_policy_ab12cd34",
            "snp_tools_ef56gh78",
            "snp_context_req_1693660296500",
            "s_adn"
          ],
          "payload_started": {
            "name": "openai.responses.create",
            "model": "gpt-5-mini",
            "arguments": { "instructions_preview": "...", "tools_count": 3 },
            "prompt_provenance": {
              "parts": [
                { "type": "channel_preamble", "value": "..." },
                { "type": "prompt_adaptations", "value": "..." },
                { "type": "personality", "value": "..." },
                { "type": "user_instruction", "value": "what’s the weather today?" },
                { "type": "tool_schemas_snapshot", "value": "tools:3" }
              ]
            }
          },
          "ended_at": "2025-09-02T20:11:36.800Z",
          "duration_ms": 548
        },
        {
          "step_id": "s3",
          "label": "assistant_message",
          "depends_on": "s_llm",
          "payload_completed": { "text": "In Canberra it's ~13°C with showers." }
        }
      ]
    }
  ]
}
```

This structure allows you to:

* Generate **D2 diagrams** automatically (including `depends_on` edges).
* Feed **analytics** or dashboards.
* Replay sessions or runs for debugging.

---

## **6. Generating Visualizations**

From this JSON:

* A **session-level diagram** shows each run as a swimlane.
* **Drill-down diagrams** show step-level detail within a single run.
* Nodes link back to source log IDs or response IDs for debugging.

Artifact generation and access:

- On session finalization, the server writes two artifacts under `websocket-server/runtime-data/thoughtflow/`:
  - `<session_id>.json`: consolidated ThoughtFlow JSON
  - `<session_id>.d2`: auto-generated D2 diagram source
- These are served over HTTP at `/thoughtflow/<session_id>.json` and `/thoughtflow/<session_id>.d2`.
- A `thoughtflow.artifacts` event is emitted to the web app with absolute URLs so they can be opened directly.

---

## **6.1 Prompt provenance and snapshots (Approach B)**

To understand how prompts are constructed, each LLM `assistant_call` now includes inline `prompt_provenance` and depends on lightweight snapshot steps for long‑lived inputs.

- __Snapshots__: small steps emitted when an input is used, even if it was produced earlier (e.g., at boot). Examples:
  - `policy.snapshot::<hash>` with a preview and produced_at
  - `tool.schemas.snapshot::<hash>` with tool count
  - `channel.preamble::<channel>`
- __Dependencies__: the LLM `assistant_call` step has `depends_on` edges pointing to the relevant snapshots and the current `user_message`.
- __Inline provenance__: the `assistant_call.payload.prompt_provenance` contains:
  - `parts`: ordered list of prompt components (e.g., `channel_preamble`, `prompt_adaptations`, `personality`, `user_instruction`, `tool_schemas_snapshot`). `prompt_adaptations` is a normal component; its presence and placement simply reflect how the code assembled the final string.
  - `final_prompt`: the final instruction string sent to the model
  - `assembly`: optional spans mapping parts into the final string

Example LLM step (excerpt):

```json
{
  "step_id": "step_llm_req_123",
  "label": "assistant_call",
  "depends_on": ["step_user_req_123", "snp_policy_ab12cd34", "snp_tools_ef56gh78", "snp_channel_text"],
  "payload_started": {
    "name": "openai.responses.create",
    "model": "gpt-5-mini",
    "arguments": { "instructions_preview": "You are...", "tools_count": 7 },
    "prompt_provenance": {
      "parts": [
        { "type": "channel_preamble", "value": "Text channel guidance..." },
        { "type": "prompt_adaptations", "value": "Adaptations for base/text..." },
        { "type": "personality", "value": "You are helpful..." },
        { "type": "user_instruction", "value": "what's the weather?" },
        { "type": "tool_schemas_snapshot", "value": "tools:7" }
      ],
      "final_prompt": "Text channel guidance...\nAdaptations for base/text...\nYou are helpful...",
      "assembly": [ { "part": 0, "start": 0, "end": 24 }, { "part": 1, "start": 25, "end": 54 }, { "part": 2, "start": 55, "end": 88 } ]
    }
  }
}
```

Rendering in D2:

- Snapshot nodes appear as regular steps and feed edges directly into the LLM `assistant_call` node.
- Hovering the `assistant_call` shows a tooltip with model and arguments; use the JSON view to inspect the full `prompt_provenance`.

This keeps the graph compact (no extra composition node) while preserving full traceability of prompt inputs, including artifacts produced before the session.

---

## 6.2 Adaptations: Storage and Retrieval

Adaptations are stored and served in a way that is easy to audit, modify, and hot‑reload at runtime.

- Defaults (fixed IDs, versioned): `websocket-server/src/adaptations.ts` — typed list of items `{ id, title, content, scope, tags?, enabled? }`.
- Edits (per‑id changes only, no add/delete): `websocket-server/adaptations.edits.json` — `{ [id]: { title?, content?, enabled?, updated_at } }`.
- Tools: `list_adaptations`, `get_adaptation`, `update_adaptation`, `reload_adaptations` (optional `preview_adaptations`).
- Assembly: code concatenates enabled items (filtered by agent/channel) into a single `prompt.adaptations` string and inserts it where appropriate in `websocket-server/src/session/chat.ts`.
- Discoverability: adaptations appear (a) as a concise `prompt.adaptations` artifact step (with `modifiable: true` and included IDs) and (b) in `prompt_provenance.parts` as `prompt_adaptations`. No separate catalog section is required in the consolidated JSON.


## **7. Closing Thought**

A chat transcript shows what was said.
A **ThoughtFlow** shows **how it happened**.

By capturing sessions, runs, and steps in a structured way, you enable better:

* **Debugging**
* **Optimization**
* **Self-reflection**

This is the foundation for agents that **don’t just react — they evolve**.
