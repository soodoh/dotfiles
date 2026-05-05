---
name: investigation-work
description: Use when diagnosing blockers, failing verification, bugs, unclear requirements, regressions, flaky tests, or root-cause questions before or during implementation work. Use this before making more code changes when evidence is missing or repeated fixes are failing. For standalone bug/root-cause investigations that lead to implementation, create an evidence-backed planning seed and route to `planning-work`; inside `quick-implementation-work` or `implementation-work`, return findings only to the active implementation parent/run log.
---

# Investigation Work

Diagnose uncertainty with evidence, then hand findings back to the caller. This skill is cross-harness: it must work in pi and Claude Code. Do **not** rely on Superpowers, Ralph Wiggum, or any harness-specific workflow extension.

## Role Boundary

Investigation is not implementation.

Allowed:

- Read/search code and docs.
- Run diagnostic commands and tests.
- Use external documentation/web research when it materially affects the answer.
- Create temporary logs, probes, repro tests, or scripts to gather evidence.
- Write investigation notes under `.agents/investigations/`.

Required:

- Prefer local repo evidence first.
- Revert all temporary code/test/script/probe edits before finishing unless the caller explicitly promotes them into the approved implementation plan.
- Report what was changed temporarily and how it was reverted.
- Do not make permanent product fixes.
- Do not invoke any workflow skill (`planning-work`, `quick-implementation-work`, `implementation-work`, or `investigation-work`) from child investigator subagents; return findings to the parent orchestrator instead.

If no subagent mechanism is available for a non-trivial investigation, stop and tell the user this workflow requires subagents.

## Invocation Modes and Handoffs

Classify the invocation before dispatching investigators or writing notes:

| Mode                                  | Signals                                                                                                                                                                                            | Handoff behavior                                                                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded implementation investigation | Caller provides an approved plan path, run log path, task ID/review scope, failed command output, writer/reviewer concern, or asks from inside `implementation-work` / `quick-implementation-work` | Return findings only to the implementation parent. Update the run log or provide exact paste-ready run-log text. Do **not** invoke or hand off to `planning-work`; the approved plan boundary is already active.                                                  |
| Standalone pre-planning investigation | Direct user asks to diagnose a bug/blocker/root cause and there is no active implementation run log or approved-plan execution context                                                             | Finish the investigation, write `.agents/investigations/<slug>.md`, then create a planning seed if code/product/test/docs changes are recommended. Continue by activating `planning-work` with that seed unless the user explicitly asked for investigation only. |

A standalone planning seed should live at `.agents/planning/<slug>/investigation-seed.md` and include:

- Investigation note path.
- User request and diagnosed root cause or likely cause.
- Evidence with file paths, commands, and relevant source links.
- Recommended implementation goal and acceptance criteria candidates.
- Known constraints, risks, validation commands, and out-of-scope decision triggers.
- Open questions for planning.

This bridge is intentionally disabled for embedded implementation investigations because routing back through planning would reinterpret an already-approved plan and could corrupt the active implementation flow.

## Canonical Role Prompt Template

Use `prompts/investigator.md` for investigation subagent dispatches. This template is the cross-harness source of truth; fill its placeholders from the invocation mode, blocker, plan path, run log, failed command output, and relevant files.

In Claude Code, paste the filled template into `Task`. In pi, pass the filled template as the `subagent(...)` task prompt. Do not improvise a shorter investigation prompt unless the template is clearly inapplicable; preserve the role boundary, temporary-edit revert rules, evidence requirements, and output format.

## Harness Adapters

| Operation             | pi                                                             | Claude Code                                  |
| --------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| Dispatch investigator | Use `subagent(...)` with read/diagnostic scope                 | Use `Task` with read/diagnostic scope        |
| External research     | Use available web/search tools when material                   | Use available web/search tools when material |
| Temporary edits       | Use normal edit/write tools, record diff, revert before finish | Same                                         |
| Notes                 | Write `.agents/investigations/<slug>.md`                       | Same                                         |

## Investigation PIV Loop

Use Plan → Investigate → Validate.

### 1. Plan

Create or update `.agents/investigations/<slug>.md` with:

- Invocation mode: embedded implementation investigation or standalone pre-planning investigation.
- Caller and context: direct user request or implementation task/run log path.
- Question/blocker being investigated.
- Known facts and evidence.
- Hypotheses to test.
- Commands/files likely to inspect.
- Whether temporary probes/repro artifacts may be needed.
- Revert plan for any temporary edits.

When invoked by `implementation-work` or `quick-implementation-work`, include the plan path, run log path, task ID or review scope, failed command output, changed files, and reviewer/writer concern.

### 2. Investigate

Local first:

- Read relevant source, tests, configuration, docs, recent diffs, and project instructions.
- Follow imports/callers where needed.
- Run focused diagnostic commands before broad commands.
- If reproducing a bug, prefer the smallest repro command/test.

External when material:

- Use primary sources for APIs, dependency behavior, platform changes, security guidance, or current ecosystem facts.
- Record links/sources and why they matter.

Temporary edits:

- Allowed only for logs, probes, repro tests, or scripts that improve diagnosis.
- Before editing, record current git status/diff scope.
- Keep edits minimal and labeled as temporary.
- Capture evidence produced by the edit.
- Revert the temporary edit before finalizing unless the caller explicitly promotes it into the approved implementation plan.

Use `prompts/investigator.md` for each investigator subagent. Use multiple investigator subagents only when questions are independent, such as one local-code investigator and one external-docs investigator. Synthesize their results before returning.

### 3. Validate

Do not stop at a plausible theory. Validate with evidence:

- Show the command, file path, trace, source link, or code path that supports the finding.
- State which hypotheses were ruled out.
- If a repro was created temporarily, explain the failure/pass behavior observed and confirm the artifact was reverted.
- If root cause cannot be proven, say so and identify the next smallest diagnostic step.

## Output Format

Return a concise handoff:

```markdown
## Investigation Result

Status: ROOT_CAUSE_FOUND | LIKELY_CAUSE | NEEDS_MORE_INFO | NOT_REPRODUCED | BLOCKED

### Question / Blocker

### Evidence

- file:line / command / source link evidence

### Hypotheses Tested

- Confirmed:
- Ruled out:
- Still possible:

### Temporary Edits

- Made:
- Evidence captured:
- Reverted: yes/no

### Recommendation

- Next implementation step, if any
- Whether this stays within the approved plan
- Whether user approval is required before implementation continues
```

When invoked from `implementation-work` or `quick-implementation-work`, also update the run log or provide exact text for the parent orchestrator to paste into it.

When invoked standalone and implementation is recommended, add:

```markdown
### Planning Seed

- Path: `.agents/planning/<slug>/investigation-seed.md`
- Recommended next skill: `planning-work`
- Planning prompt: <concise prompt that tells the planner to read the investigation seed and create an approved plan/DAG>
```

Then activate `planning-work` with the planning prompt when the harness/session supports skill routing. If not, tell the user to start `planning-work` with that prompt. Do not do this for embedded implementation investigations.

## Escalate Instead of Guessing

Stop and ask the caller/user when:

- The next step requires a product, architecture, migration, destructive, or security-sensitive decision outside the approved plan.
- Temporary edits cannot be safely reverted.
- Reproduction requires credentials, services, data, or environments you do not have.
- Evidence contradicts the approved plan.
- You cannot distinguish between multiple plausible causes after focused investigation.

## Red Flags

- Permanent fixes made during investigation.
- Temporary logs/probes left in the tree.
- External docs used without checking local code impact.
- A conclusion without command/file/source evidence.
- Ignoring a failed verification because the theory seems convincing.
