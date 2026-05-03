---
name: investigation-work
description: Use when diagnosing blockers, failing verification, bugs, unclear requirements, regressions, or root-cause questions before or during implementation work.
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
- Do not invoke `planning-work` or `implementation-work` from child investigator subagents.

If no subagent mechanism is available for a non-trivial investigation, stop and tell the user this workflow requires subagents.

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

- Caller and context: direct user request or implementation task/run log path.
- Question/blocker being investigated.
- Known facts and evidence.
- Hypotheses to test.
- Commands/files likely to inspect.
- Whether temporary probes/repro artifacts may be needed.
- Revert plan for any temporary edits.

When invoked by `implementation-work`, include the plan path, run log path, task ID, failed command output, changed files, and reviewer/writer concern.

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

Use multiple investigator subagents only when questions are independent, such as one local-code investigator and one external-docs investigator. Synthesize their results before returning.

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

When invoked from `implementation-work`, also update the run log or provide exact text for the parent orchestrator to paste into it.

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
