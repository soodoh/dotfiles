---
description: Classify a plan as simple, medium, or complex for implementation routing.
argument-hint: <plan-path-or-summary>
---
# Classify Plan Complexity

Classify the approved/selected plan into exactly one complexity:

- `simple`: one or two localized edits, no schema/API changes, small validation surface.
- `medium`: multiple files or tests but one coherent implementation thread; can use multiple workers and one final review.
- `complex`: multiple checklist tasks, likely independent waves, migrations/contracts, or multi-module changes; needs per-task review loops.

Return JSON only:

```json
{"complexity":"simple","reason":"..."}
```
