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
* **Artifacts**: the inputs and outputs of steps, like raw prompts, assistant replies, tool responses, or stored values.

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

All ThoughtFlow visualizations are generated from a consolidated JSON representation written at session finalization.

### **Current Consolidated JSON Shape**

```
{
  "session_id": "sess_1693660012345",
  "started_at": "2025-09-02T20:11:35.442Z",
  "ended_at": "2025-09-02T20:12:05.442Z",
  "runs": [
    {
      "run_id": "run_1",
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
          "step_id": "s3",
          "label": "assistant_message",
          "depends_on": ["s1", "s2_out"],
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

To understand how prompts are constructed, each LLM `tool_call` now includes inline `prompt_provenance` and depends on lightweight snapshot steps for long‑lived inputs.

- __Snapshots__: small steps emitted when an input is used, even if it was produced earlier (e.g., at boot). Examples:
  - `policy.snapshot::<hash>` with a preview and produced_at
  - `tool.schemas.snapshot::<hash>` with tool count
  - `channel.preamble::<channel>`
- __Dependencies__: the LLM `tool_call` step has `depends_on` edges pointing to the relevant snapshots and the current `user_message`.
- __Inline provenance__: the `tool_call.payload.prompt_provenance` contains:
  - `parts`: ordered list of prompt components (e.g., `channel_preamble`, `personality`, `user_instruction`, `tool_schemas_snapshot`)
  - `final_prompt`: the final instruction string sent to the model
  - `assembly`: optional spans mapping parts into the final string

Example LLM step (excerpt):

```json
{
  "step_id": "step_llm_req_123",
  "label": "tool_call",
  "depends_on": ["step_user_req_123", "snp_policy_ab12cd34", "snp_tools_ef56gh78", "snp_channel_text"],
  "payload_started": {
    "name": "openai.responses.create",
    "model": "gpt-5-mini",
    "arguments": { "instructions_preview": "You are...", "tools_count": 7 },
    "prompt_provenance": {
      "parts": [
        { "type": "channel_preamble", "value": "Text channel guidance..." },
        { "type": "personality", "value": "You are helpful..." },
        { "type": "user_instruction", "value": "what's the weather?" },
        { "type": "tool_schemas_snapshot", "value": "tools:7" }
      ],
      "final_prompt": "Text channel guidance...\nYou are helpful...",
      "assembly": [ { "part": 0, "start": 0, "end": 24 }, { "part": 1, "start": 25, "end": 58 } ]
    }
  }
}
```

Rendering in D2:

- Snapshot nodes appear as regular steps and feed edges directly into the LLM `tool_call` node.
- Hovering the `tool_call` shows a tooltip with model and arguments; use the JSON view to inspect the full `prompt_provenance`.

This keeps the graph compact (no extra composition node) while preserving full traceability of prompt inputs, including artifacts produced before the session.

---

## **7. Closing Thought**

A chat transcript shows what was said.
A **ThoughtFlow** shows **how it happened**.

By capturing sessions, runs, and steps in a structured way, you enable better:

* **Debugging**
* **Optimization**
* **Self-reflection**

This is the foundation for agents that **don’t just react — they evolve**.
