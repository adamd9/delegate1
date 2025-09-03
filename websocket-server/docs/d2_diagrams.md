# D2 Diagrams – Formatting Guide (Concise)

Use this as a quick reference for editing D2 files like `docs/sales_process_simple.d2`.

## Comments
- Use `#` for comments.
- Keep comments above the block they describe.

```d2
# This is a comment about stage0
stage0: { ... }
```

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
