# D2 Diagrams – Formatting Guide (Concise)

Use this as a quick reference for editing D2 files like `docs/sales_process_simple.d2`.

## Comments
- Use `#` for comments.
- Keep comments above the block they describe.

```d2
# This is a comment about stage0
stage0: { ... }
```

## Tooltips
- Use `tooltip: "..."` to add hover text to any node.
- Escape quotes `"` and newlines `\n` inside tooltip strings.
- Keep tooltips concise; the generator truncates long content.

```d2
# Simple tooltip example
x: { tooltip: "Total abstinence is easier than perfect moderation" }
y: { tooltip: "Gee, I feel kind of LIGHT in the head now,\nknowing I can't make my satellite dish PAYMENTS!" }
x -> y
```

### ThoughtFlow usage

Step types (enum):
- `user_message`, `assistant_message`, `tool_call`, `tool_output`, `tool_error`, `generic`

Dependency model:
- Each step may set `depends_on` as a string or string[] of prior `step_id`s.
- The D2 generator draws edges from each dependency to the step.
- If no steps include `depends_on`, a simple linear chain is rendered.

First-class tool output:
- `tool_output` is emitted as its own step, depending on the `tool_call` step.
- Its label includes the tool name and a short snippet of the output when available.

Snippet and tooltip policy:
- Labels show a short, single-sentence snippet (~140 chars) for readability.
- `user_message`/`assistant_message`: label snippet is the first sentence of the text; tooltip shows the full text (when available).
- `tool_call`: label includes call index and duration; tooltip shows tool name, args, and duration in ms.
- `tool_output`: label includes the tool name and output snippet; tooltip contains the full JSON/string output.

```d2
run_1: {
  label: "Run 1 — completed, 842ms"
  direction: down
  class: runbox
  s2: {
    label: |md
      2. tool_call (157ms)
      ---
      tool: weather.get
      args: {"city":"Melbourne"}
    |
    shape: rectangle
    class: tool
    tooltip: "tool: weather.get\nargs: {\"city\":\"Melbourne\"}\nms: 157"
  }
  s2_out: {
    label: |md
      tool_output
      ---
      {"tempC":13,"conditions":"Showers"}
    |
    shape: rectangle
    class: toolout
    tooltip: "{\n  \"tempC\": 13,\n  \"conditions\": \"Showers\"\n}"
  }
  s2 -> s2_out
}
```

Rendering styles:
- Node classes applied by step type: `user`, `assistant`, `tool`, `toolout`, `error`.
- Top-level run container uses `class: runbox`.

Artifact locations and UI link:
- On session finalization, artifacts are written under `websocket-server/runtime-data/thoughtflow/`:
  - `<session_id>.json` (consolidated ThoughtFlow runs/steps)
  - `<session_id>.d2` (auto-generated diagram)
- The server emits a `thoughtflow.artifacts` event via `/logs` with `json_path` and `d2_path`.
- The web app surfaces a breadcrumb titled "🧩 ThoughtFlow artifacts" linking to these paths.

Best practices:
- Keep labels short; move verbose details into tooltips.
- Prefer JSON for args/output; newlines are supported in tooltips.
- Avoid putting style keys in tooltips; they’re plain text.

## Classes (reuse styles)
- Define once under `classes:`.
- Apply with `class: name` on nodes (or `classes: [a, b]` for multiples).

```d2
classes: {
  sales: {
    style: { fill: "#E8F1FF" stroke: "#6FA8FF" border-radius: 6 }
  }
  presales: {
    style: { fill: "#E8FFF1" stroke: "#66D19E" border-radius: 6 }
  }
  governance: {
    style: { fill: "#FFF8E6" stroke: "#F4B400" border-radius: 6 }
  }
}

node_a: {
  label: "Sales"
  shape: rectangle
  class: sales
}
```

## Markdown in labels
- Use `label: |md` to enable markdown; end with a single `|` line.
- Prefer headers + bullet lists for readability.
- Escape `$` as `\$` when needed.

```d2
node_b: {
  label: |md
    # Sales (AE)
    - Key point A
    - ACV ≥ \$50k
    |
  shape: rectangle
}
```

## Shapes and layout
- Default layout direction at top: `direction: down` (or `right`/`left`/`up`).
- Set shapes explicitly for clarity: `shape: rectangle`.
- Keep nodes grouped in stage blocks for ordering.

```d2
direction: down

stage1: {
  label: "Stage 1 — Qualified"
  direction: down
  sales: { shape: rectangle }
  sa:    { shape: rectangle }
}
```

## Spacing and size (optional)
- Add width/height in class styles for consistency.
- Use `gap` at top level or margins per node if needed.

```d2
classes: { card: { style: { width: 360 height: 120 } } }
```

## Linking / ordering
- Keep the simple flow linear at the end of the file.

```d2
stage0 -> stage1 -> stage2 -> stage3 -> stage4 -> stage5 -> stage6 -> stage7
```

## Naming conventions
- Use lower‑snake for node keys inside a stage (e.g., `sales`, `sa`, `governance_value_selling`).
- Use `stageN` for top‑level stages with `label` carrying the human name.

## Do / Don’t
- Do: one responsibility per sub‑box; reuse classes.
- Do: escape `$` in markdown labels.
- Don’t: put unsupported style keys (e.g., `font-weight`); rely on class fills/strokes.

## Quick template
```d2
direction: down
classes: { /* define sales, presales, governance */ }

stageN: {
  label: "Stage N — Name"
  direction: down
  sales: { label: |md # Sales ... | shape: rectangle class: sales }
  sa:    { label: |md # Pre‑Sales ... | shape: rectangle class: presales }
  governance_note: { label: |md # Governance ... | shape: rectangle class: governance }
}
```
