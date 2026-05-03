---
name: implementation-work
description: Use when executing an approved `.agents/plans/` implementation plan artifact with subagents, review gates, verification, and final auto-commit.
---

# Implementation Work

Execute an approved plan+DAG artifact using subagents. This skill is cross-harness: it must work in pi and Claude Code. Do **not** rely on Superpowers, Ralph Wiggum, or any harness-specific workflow extension.

## Preconditions

Stop before writing if any precondition fails:

- A subagent mechanism is available. If not, stop: this workflow requires subagents.
- The input is an approved `.agents/plans/*.md` artifact with `Approval Status: approved` or equivalent approval stamp. If missing, redirect to `planning-work`.
- The git working tree is clean before execution starts, ignoring `.agents/` workflow artifacts created by this workflow.
- The approved plan contains a task DAG, verification policy, model tier mapping, and out-of-scope decision triggers.

Work on the current branch; do not stop merely because it is `main` or `master`.

## Harness Adapters

| Operation         | pi                                                                                | Claude Code                                                                 |
| ----------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Dispatch subagent | Use `subagent(...)` with role-specific prompts and model overrides when available | Use `Task` with role-specific prompts and selected model when available     |
| Parallel writers  | Prefer isolated git worktrees, or pi `worktree: true` if suitable                 | Create isolated git worktrees manually or through available harness support |
| Model inventory   | Prefer `pi --list-models`                                                         | Inspect available/current model information exposed by Claude Code          |
| Skill invocation  | Parent orchestrator loads/activates `investigation-work` when needed              | Parent orchestrator loads/activates `investigation-work` when needed        |

Child subagents must not invoke `planning-work` or `implementation-work`. The parent orchestrator owns the DAG, run log, review gates, retries, and final commit.

## Model Tier Rules

Re-check model availability at execution and resume time. Use the approved tier mapping when models are still available; otherwise substitute the nearest available tier.

Default role mapping:

| Role / task type                                                                             | Tier       |
| -------------------------------------------------------------------------------------------- | ---------- |
| DAG planning already approved; do not re-plan                                                | n/a        |
| Mechanical isolated implementation, simple spec review                                       | cheap/fast |
| Integration implementation, normal investigation, conflict resolution                        | standard   |
| Architecture judgment, complex investigation, code-quality review, final whole-change review | strongest  |

If tiering is ambiguous, infer from names (`mini`, `haiku`, `flash`, `spark` = cheap; `opus`, `max`, `pro`, highest version/context/reasoning = strongest). If still ambiguous, use the current/default model for all tiers.

## Run Log and Resume

Create `.agents/runs/<plan-slug>-<timestamp>.md` before dispatching writers. Update it after every significant step:

- Plan artifact path and approval stamp.
- Git base SHA and branch.
- Model inventory and substitutions.
- DAG node status: pending, running, blocked, review-failed, complete.
- Subagent summaries and artifact paths.
- Verification commands and outcomes.
- Worktree paths and merge status.
- Final validation result and final commit SHA.

On resume, read the approved plan and latest run log, verify the git state, re-check model availability, then continue from the first incomplete DAG node. Do not duplicate completed work unless validation shows it is invalid.

## Execution Process

### 1. Prepare

1. Read the approved plan artifact.
2. Verify clean git working tree, ignoring `.agents/` workflow artifacts created by this workflow.
3. Record base SHA.
4. Re-check model tiers.
5. Create/update the run log.
6. Topologically sort the task DAG.

If the plan requires a behavior-changing task without tests and without an approved non-TDD exception, stop and ask the user; implementation cannot invent TDD exceptions.

### 2. Choose Execution Shape

For each ready DAG node or compatible group:

- Run sequentially by default when dependencies, shared files, or risk are unclear.
- Run parallel writers only when the DAG allows parallelism and tasks are independent.
- Parallel writer tasks require isolated git worktrees. If worktrees are unavailable, degrade that portion of the DAG to sequential execution.
- Larger chunks are allowed only when the approved DAG groups them as a chunk or dependencies make chunking safer than splitting.

### 3. Per-Task PIV Loop

For each task/chunk, run Plan → Implement → Verify:

**Plan**

- Extract only this task/chunk, dependencies, acceptance criteria, TDD requirement, model tier, and verification commands from the approved artifact.
- Confirm it is within approved scope.
- Create a role-specific implementer prompt. Include: task text, relevant context, files/areas, TDD requirement, verification expectations, stop rules, and report format.

**Implement**

- Dispatch exactly one writer subagent per task/chunk/worktree.
- Writer must not recursively invoke planning/implementation skills.
- Writer must stop for out-of-scope decisions, unclear requirements, or unsafe/destructive changes.
- For behavior-changing code, writer must use TDD and report RED/GREEN evidence: failing test command/output summary before production code, passing command/output after implementation.
- For non-TDD tasks, writer must report explicit verification evidence.

Writer report statuses:

| Status               | Meaning                   | Parent action                                         |
| -------------------- | ------------------------- | ----------------------------------------------------- |
| `DONE`               | Implemented and verified  | Start review gates                                    |
| `DONE_WITH_CONCERNS` | Implemented but uncertain | Read concerns; investigate if correctness/scope risk  |
| `NEEDS_CONTEXT`      | Missing info              | Provide context or invoke `investigation-work`        |
| `BLOCKED`            | Cannot complete           | Invoke `investigation-work` or escalate with evidence |

**Verify**
Run two independent review gates before marking complete:

1. **Spec/acceptance verifier:** independently reads the code/diff and checks that the task matches the approved spec, with nothing missing and no unapproved extras.
2. **Code-quality reviewer:** runs only after spec/acceptance passes; checks maintainability, simplicity, tests, project conventions, and risk.

If a reviewer finds issues, send a focused fix prompt to a writer subagent. Re-run the same review gate. After two failed fix/review cycles for the same issue, invoke `investigation-work` or escalate to the user with evidence.

Reviewer must reject TDD-required work if RED/GREEN evidence is missing.

### 4. Investigation on Blockers

Invoke `investigation-work` when:

- A writer reports `BLOCKED` or `NEEDS_CONTEXT` and local context is insufficient.
- The same review issue fails twice.
- Verification fails repeatedly without clear cause.
- A suspected root cause requires diagnosis before more implementation.

Pass the relevant plan path, run log path, task ID, failure evidence, commands, and changed files. Investigation findings may update the run log, but implementation must stay within approved scope.

### 5. Merge Parallel Worktrees

When parallel worktrees were used:

1. Merge completed worktrees back sequentially in DAG/topological order.
2. Run affected validation after each merge.
3. If conflicts occur, dispatch an implementation subagent to resolve within approved scope.
4. Re-run the affected spec and quality gates after conflict resolution.

### 6. Final Validation and Auto-Commit

After all DAG nodes pass:

1. Run targeted checks, then affected suites, then broader checks when risk justifies it.
2. Dispatch a strongest-tier final whole-change reviewer.
3. Apply only in-scope fixes required by final review; re-run relevant gates.
4. Stage only approved product/test/docs changes. Exclude `.agents/` artifacts by default.
5. Infer commit message conventions from project instructions and existing history.
6. Commit automatically after the final validation gate passes. Do not ask for another approval.
7. Never include `Co-authored-by` trailers.
8. Record final commit SHA and validation evidence in the run log.

## Stop and Ask the User

Stop for user input only when:

- A required decision is outside the approved plan/DAG.
- A destructive, security-sensitive, migration, product, or architecture choice was not approved.
- TDD is required but impossible and no exception was approved.
- The repo state makes safe auto-commit impossible.
- Subagents or worktree isolation required by the active DAG cannot be provided and sequential fallback is not safe.

## Final Response

Summarize:

- Plan artifact and run log path.
- Tasks completed.
- Validation commands and outcomes.
- Final commit SHA.
- Any deferred risks or follow-up recommendations.
