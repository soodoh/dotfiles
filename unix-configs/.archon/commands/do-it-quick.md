---
description: Quickly implement a low-complexity request with targeted validation.
argument-hint: <request>
---

# Do-It Quick Implementation

User request:

$ARGUMENTS

Complexity assessment:

$assess-complexity.output

## Mission

Implement a small, clear, low-risk change directly. This path intentionally skips grill planning, task decomposition, and review loops.

## Instructions

1. Read `$ARTIFACTS_DIR/assessment.json` if present.
2. Inspect the relevant files before editing.
3. Follow project conventions from `AGENTS.md`, `CLAUDE.md`, or equivalents if present.
4. Make the smallest coherent change that satisfies the request.
5. Do not perform unrelated cleanup.
6. Run targeted validation when practical.
7. Do not commit unless the request explicitly asks for a commit.

## TDD

Do not force TDD for quick mode. If the change is a behavior fix and a small failing test is obvious, write it first; otherwise use direct implementation plus targeted validation.

## Artifact

Write `$ARTIFACTS_DIR/quick-summary.md` with:

- Request
- Files changed
- What changed
- Validation performed
- Any follow-up needed

## Final response

End with:

- Files changed
- What changed
- Validation performed
- Follow-up needed, if any
