---
description: Create an approved-plan-ready implementation plan and structured task graph.
argument-hint: <feature/request>
---

# GSD/TDD Plan Generator

Original request:

$ARGUMENTS

Planning interview output:

$grill.output

## Mission

Create two artifacts and do not modify repository source files:

1. `$ARTIFACTS_DIR/plan.md`
2. `$ARTIFACTS_DIR/tasks.draft.json`

The plan must be grounded in the actual repository. Inspect files, existing patterns, project instructions, and validation commands before writing artifacts.

## Plan requirements

Write `$ARTIFACTS_DIR/plan.md` with:

1. Goal
2. Confirmed scope and explicit non-scope
3. Relevant files and existing patterns to follow
4. Architecture/design decisions from the interview
5. Risks and mitigations
6. Validation strategy
7. Ordered task list
8. TDD expectations and rationale
9. Full validation commands

## Task JSON requirements

Write `$ARTIFACTS_DIR/tasks.draft.json` with this exact top-level shape:

```json
{
  "tasks": [
    {
      "id": "T001",
      "title": "Short imperative title",
      "type": "feature",
      "dependsOn": [],
      "files": ["path/to/file"],
      "acceptanceCriteria": ["Specific verifiable criterion"],
      "validationCommands": ["specific command"],
      "tdd": "required"
    }
  ]
}
```

## TDD classification

Use:

- `"required"` for feature behavior, bug fixes, parser/compiler behavior, data transformations, public APIs, critical regressions, or any change where a failing test can reasonably describe the desired behavior first.
- `"optional"` for UI polish or changes where tests are useful but not obviously first.
- `"skip"` for docs-only, comments-only, mechanical config, generated lockfile-only, pure formatting, or tasks where a test-first loop would be artificial.

If TDD is skipped, the task still needs acceptance criteria and validation commands.

## Task quality bar

Each task must be:

- Atomic
- Independently reviewable
- Ordered by dependency
- Small enough for one implementation/review loop
- Specific about files and validation
- Free of unrelated cleanup or scope creep

## Before finishing

Validate the JSON syntax by reading it back or running an available JSON parser. Ensure every task has:

- unique id
- title
- type
- dependsOn array
- files array
- non-empty acceptanceCriteria array
- validationCommands array
- tdd value of `required`, `optional`, or `skip`

End by reporting:

- Plan path
- Task JSON path
- Task count
- Key assumptions
- Any risks or open questions that remain
