---
description: Assess request complexity and choose quick, standard, or deep Do-It mode.
argument-hint: <request, optionally --quick|--standard|--deep>
---

# Do-It Complexity Assessment

User request:

$ARGUMENTS

## Mission

Choose the lightest workflow mode that can safely satisfy the request. Inspect the repository enough to make an informed call, but do not modify files.

Honor explicit user overrides first:

- If `$ARGUMENTS` contains `--quick`, choose `quick`.
- If `$ARGUMENTS` contains `--standard`, choose `standard`.
- If `$ARGUMENTS` contains `--deep`, choose `deep`.

## Modes

### quick

Use for obvious, low-risk work:

- One or two files likely changed
- No meaningful architecture decision
- Requirements are clear
- Low regression risk
- TDD would be trivial or artificial
- Examples: typo/docs edit, small config tweak, simple alias/keybinding change, obvious localized fix

### standard

Use for gray-area or medium work:

- Cohesive change, but not trivial
- Usually 2-5 files
- Some planning and review are useful
- TDD may be useful for behavior changes
- No need to break into multiple dependent implementation tasks
- Requirements are mostly clear

When unsure between quick and standard, choose `standard`.

### deep

Use only when complexity earns the heavier process:

- Multiple dependent tasks
- Architecture/design decisions need user input
- Requirements are ambiguous or product decisions are unresolved
- High regression or security risk
- Cross-cutting refactor/migration/new subsystem
- Needs per-task review loops and explicit plan approval

When unsure between standard and deep, choose `standard` unless the uncertainty is about requirements, user intent, or architecture.

## Repository inspection

Before deciding, check:

1. Project instructions (`AGENTS.md`, `CLAUDE.md`, or equivalents) if present.
2. Likely files/areas touched by the request.
3. Existing validation commands from package scripts, Makefile, justfile, etc. when relevant.

## Artifact

Write your assessment to `$ARTIFACTS_DIR/assessment.json` with the same JSON object you return.

## Required output

Return exactly one JSON object and no markdown:

```json
{
  "mode": "quick",
  "confidence": "high",
  "reason": "Short explanation of why this mode is appropriate.",
  "estimatedFiles": 1,
  "needsTdd": false,
  "needsPlanningInterview": false
}
```
