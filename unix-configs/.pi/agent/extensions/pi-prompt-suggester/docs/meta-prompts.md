# Prompt Templates (Current)

## A) Seeder prompt contract (agentic)

Seeder runs as an iterative loop and must output either:

1. `type: "tool"` with one of read-only tools: `ls | find | grep | read`
2. `type: "final"` with complete seed JSON

Final seed JSON must include:
- `projectIntentSummary`
- `objectivesSummary`
- `constraintsSummary`
- `principlesGuidelinesSummary`
- `implementationStatusSummary`
- `topObjectives[]`
- `constraints[]`
- `keyFiles[]` with `{ path, whyImportant, category }`
- `categoryFindings` for required categories:
  - `vision`
  - `architecture`
  - `principles_guidelines`
  each as `{ found: boolean, rationale: string, files: string[] }`
- `openQuestions[]`
- optional `reseedNotes`

Validation rules:
- required `categoryFindings` must be present
- each finding must have non-empty rationale
- `found=false` is valid with rationale
- if `found=true`, at least one matching key file must be categorized accordingly

---

## B) Suggestion prompt contract

Inputs include:
- latest assistant turn
- turn status: `success | error | aborted`
- abort context note (when present)
- recent user prompts
- tool signals + touched files + unresolved questions
- intent seed (all summary fields + key files + category findings)
- recent accepted/changed steering examples

Output:
- plain text only
- either one next-prompt suggestion (can be multiline)
- or exact no-suggestion token (`[no suggestion]` by default)

Behavior notes:
- non-success turns (`error`, `aborted`) can be fast-pathed to `continue` by config

---

## C) Sizing guidance used by seeder

Soft targets (not hard truncation):
- `projectIntentSummary`: target 1000–3000 chars, soft max 5000
- `objectivesSummary`: target 800–2500 chars, soft max 5000
- `constraintsSummary`: target 800–2500 chars, soft max 5000
- `principlesGuidelinesSummary`: target 800–2500 chars, soft max 5000
- `implementationStatusSummary`: target 400–1500 chars, soft max 5000
