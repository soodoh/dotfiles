---
description: Create a lightweight standard-mode plan and state file for a whole-change PIV loop.
argument-hint: <request>
---

# Do-It Standard Plan

User request:

$ARGUMENTS

Complexity assessment:

$assess-complexity.output

## Mission

Create a lightweight implementation plan for a medium-complexity change. This path should preserve PIV discipline without the heavier deep-mode grill interview or per-task decomposition.

Do not modify repository source files.

## Context gathering

Inspect enough of the repository to ground the plan:

1. Project instructions (`AGENTS.md`, `CLAUDE.md`, or equivalents) if present.
2. Likely files/areas to change.
3. Existing tests and validation commands.
4. Similar implementation patterns to follow.

## Write `$ARTIFACTS_DIR/standard-plan.md`

Include:

1. Goal
2. Scope and non-scope
3. Files/areas likely to change
4. Existing patterns to follow
5. Implementation steps
6. Acceptance criteria
7. TDD recommendation
8. Validation commands
9. Risks/follow-ups

## Write `$ARTIFACTS_DIR/standard-state.json`

Use this shape:

```json
{
  "status": "running",
  "phase": "worker",
  "reviewRounds": 0,
  "maxReviewRounds": 4,
  "tdd": "optional",
  "validationCommands": ["specific command"],
  "notes": ""
}
```

TDD classification:

- `required` for behavior changes, bug fixes, public APIs, data transformations, parser/compiler behavior, or regression-prone logic.
- `optional` for medium changes where tests are useful but test-first is not mandatory.
- `skip` for docs/config/mechanical changes where test-first would be artificial.

## Write progress

Initialize or append `$ARTIFACTS_DIR/progress.md` with:

```markdown
# Do-It Standard Progress

## Plan Created

- Mode: standard
- TDD: required|optional|skip
- Validation commands: ...
```

Create `$ARTIFACTS_DIR/reviews/` if needed.

## Final response

Report:

- Plan path
- TDD classification
- Validation commands
- Why standard mode is sufficient
