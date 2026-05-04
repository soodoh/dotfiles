---
name: quick-implementation-work
description: |
  Use when executing an approved `.agents/plans/` DAG selected for quick-batch implementation: subagent writers complete DAG tasks in the current checkout, then one whole-change review/fix PIV loop runs after all tasks are completed.
---

# Quick Implementation Work

Execute an approved `quick-batch` plan+DAG with subagent writers, no required parallel worktrees, and a whole-change review PIV loop after all DAG tasks are implemented.

This skill is for low-to-medium risk work where `planning-work` decided that per-task review gates and isolated worktrees are unnecessary. For deep/high-risk work, use `implementation-work` instead.

## Preconditions

Stop before writing if any precondition fails:

- A subagent mechanism is available. If not, stop: this workflow requires subagents.
- The input is an approved `.agents/plans/*.md` artifact, or a `.agents/handoffs/*-implementation.md` file that points to one, with `Approval Status: approved` or equivalent approval stamp.
- The approved plan selects `quick-batch` mode or explicitly names `quick-implementation-work` as the implementation skill. If it selects `deep-gated` or `implementation-work`, stop and redirect to `implementation-work`.
- This skill is running in a fresh/minimal session context, not the same conversation that created the plan. If the planning conversation is still in context, stop and ask the user to clear context or open a new session with the handoff prompt.
- The git working tree is clean before execution starts, ignoring `.agents/` workflow artifacts created by this workflow.
- The approved plan contains a task DAG, verification policy, model tier mapping, complexity/routing rationale, and out-of-scope decision triggers.

Work on the current branch; do not stop merely because it is `main` or `master`.

## Key Differences from `implementation-work`

- Still uses subagent writers for DAG tasks.
- Does **not** require isolated git worktrees for parallel writer tasks.
- Runs writer tasks sequentially by default; may run ready tasks in parallel in the same checkout only when they are independent, low-risk, and non-overlapping.
- Does **not** run per-task spec/code-quality review gates.
- Runs a whole-change review/fix PIV loop only after all DAG tasks complete.
- Escalates to `implementation-work` or the user if the work proves too risky for quick-batch execution.

## Harness Adapters

| Operation        | pi                                                                                                              | Claude Code                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Dispatch writer  | Use `subagent(...)` with the implementer prompt and model tier when available                                   | Use `Task` with the implementer prompt and selected model when available                               |
| Parallel writers | May use parallel subagent dispatch in the same checkout when tasks are independent; do not require worktrees    | May dispatch parallel Tasks only when their file scopes do not overlap; do not require worktrees       |
| Model inventory  | Prefer `pi --list-models`                                                                                       | Inspect available/current model information exposed by Claude Code                                     |
| Fresh context    | Prefer a new pi session, or a cleared/minimal context containing only the handoff prompt and approved artifacts | Prefer `/clear` or a new Claude Code session containing only the handoff prompt and approved artifacts |
| Investigation    | Parent orchestrator loads/activates `investigation-work` when needed                                            | Parent orchestrator loads/activates `investigation-work` when needed                                   |

Child subagents must not invoke `planning-work`, `quick-implementation-work`, or `implementation-work`. The parent orchestrator owns the DAG, run log, review/fix loop, final validation, and commit.

## Canonical Role Prompt Templates

Reuse the implementation prompt templates from the deep executor rather than creating parallel prompt implementations:

| Role                        | Template path                                             | When to use                                                                             |
| --------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Implementer/writer          | `../implementation-work/prompts/implementer.md`           | Initial implementation for each DAG task/chunk                                          |
| Whole-change spec review    | `../implementation-work/prompts/spec-verifier.md`         | Adapt for the full approved plan and combined diff after all tasks complete             |
| Whole-change quality review | `../implementation-work/prompts/code-quality-reviewer.md` | Adapt for the full combined diff after whole-change spec review passes                  |
| Fix writer                  | `../implementation-work/prompts/fix-writer.md`            | Focused fixes after a failed whole-change review gate                                   |
| Final reviewer              | `../implementation-work/prompts/final-reviewer.md`        | Optional final whole-change review before final validation/commit when risk warrants it |

When adapting per-task templates for whole-change review, preserve the role boundary, evidence requirements, TDD evidence checks, output format, and no-edit rule for reviewers.

## Model Tier Rules

Re-check model availability at execution and resume time. Use the approved tier mapping when models are still available; otherwise substitute the nearest available tier.

Default role mapping:

| Role / task type                                                       | Tier       |
| ---------------------------------------------------------------------- | ---------- |
| Mechanical isolated implementation and simple verification             | cheap/fast |
| Normal implementation, integration touch points, and focused fixes     | standard   |
| Whole-change review, architecture judgment, repeated failure diagnosis | strongest  |

If tiering is ambiguous, infer from names (`mini`, `haiku`, `flash`, `spark` = cheap; `opus`, `max`, `pro`, highest version/context/reasoning = strongest). If still ambiguous, use the current/default model for all tiers.

## Run Log and Resume

Create `.agents/runs/<plan-slug>-quick-<timestamp>.md` before dispatching writers. Update it after every significant step:

- Plan artifact path and approval stamp.
- Git base SHA and branch.
- Selected route: `quick-batch` / `quick-implementation-work`.
- Model inventory and substitutions.
- DAG node status: pending, running, blocked, complete.
- Subagent summaries and artifact paths.
- Verification commands and outcomes.
- Whole-change review rounds, findings, fixes, and validation.
- Final validation result and final commit SHA.

On resume, read the approved plan and latest quick run log, verify the git state, re-check model availability, then continue from the first incomplete DAG node. If all DAG nodes are complete, resume the whole-change review/fix loop. Do not duplicate completed work unless validation shows it is invalid.

## Execution Process

### 1. Prepare

1. Read the handoff file if provided, then read the approved plan artifact.
2. Confirm this is a fresh/minimal implementation session.
3. Verify the plan selected `quick-batch` / `quick-implementation-work`.
4. Verify clean git working tree, ignoring `.agents/` workflow artifacts created by this workflow.
5. Record base SHA.
6. Re-check model tiers.
7. Create/update the run log.
8. Topologically sort the task DAG.

If the plan requires a behavior-changing task without tests and without an approved non-TDD exception, stop and ask the user; implementation cannot invent TDD exceptions.

### 2. Choose Execution Shape

For each ready DAG node or compatible ready group:

- Sequential execution is always acceptable and is the default when shared files, ordering, or risk are unclear.
- Parallel execution in the same checkout is allowed only when the approved DAG and current inspection show tasks are independent, non-overlapping, and low-risk.
- Parallel tasks do **not** need their own worktrees in this skill.
- If parallel tasks overlap or become risky, degrade to sequential execution.
- If the work now appears to require isolated worktrees or per-task review gates, stop and recommend switching to `implementation-work` with evidence.

### 3. DAG Writer Phase

For each selected task/chunk:

1. Extract only this task/chunk, dependencies, acceptance criteria, TDD requirement, model tier, and verification commands from the approved artifact.
2. Confirm it is within approved scope.
3. Fill `../implementation-work/prompts/implementer.md` with the task context.
4. Dispatch exactly one writer subagent per task/chunk.
5. Writer must not recursively invoke planning/implementation skills, launch subagents, or commit.
6. Writer must stop for out-of-scope decisions, unclear requirements, or unsafe/destructive changes.
7. For behavior-changing code, writer must follow the approved TDD policy and report RED/GREEN evidence when TDD is required.
8. Record the writer report and update the run log.
9. Run task-specific or targeted verification when cheap and useful, but do not run per-task review gates.

Writer report statuses:

| Status               | Meaning                   | Parent action                                                                                                                                          |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DONE`               | Implemented and verified  | Mark task complete when targeted checks are acceptable                                                                                                 |
| `DONE_WITH_CONCERNS` | Implemented but uncertain | Inspect concerns; either continue to whole-change review, dispatch a focused fix, or invoke `investigation-work` if correctness/scope risk is material |
| `NEEDS_CONTEXT`      | Missing info              | Provide context, invoke `investigation-work`, or escalate to user                                                                                      |
| `BLOCKED`            | Cannot complete           | Invoke `investigation-work`, switch to `implementation-work`, or escalate with evidence                                                                |

### 4. Whole-Change Review PIV Loop

After all DAG tasks are complete, run Plan → Inspect → Fix → Verify against the combined change.

For each review round, up to the plan's retry limit or 3 rounds by default:

1. Run targeted validation commands from the plan and collect evidence.
2. Dispatch a whole-change spec/acceptance verifier by adapting `../implementation-work/prompts/spec-verifier.md` to the full approved plan, all acceptance criteria, all completed tasks, and the combined diff from base SHA.
3. If spec review fails, dispatch a focused fix writer using `../implementation-work/prompts/fix-writer.md`; then re-run targeted validation and restart the whole-change review round.
4. If spec review passes, dispatch a whole-change code-quality reviewer by adapting `../implementation-work/prompts/code-quality-reviewer.md` to the combined diff and validation evidence.
5. If quality review fails with Critical or Important issues, dispatch a focused fix writer; then re-run targeted validation and restart the whole-change review round.
6. If both reviews pass, mark the whole-change review loop complete.

Invoke `investigation-work` when:

- A writer reports `BLOCKED` or `NEEDS_CONTEXT` and local context is insufficient.
- The same review issue fails twice.
- Verification repeatedly fails without clear cause.
- A suspected root cause requires diagnosis before more implementation.

If a review finding requires a product, architecture, migration, destructive, or security-sensitive decision outside the approved plan, stop and ask the user.

### 5. Final Validation and Auto-Commit

After the whole-change review loop passes:

1. Run targeted checks, then affected suites, then broader checks when risk justifies it.
2. Optionally dispatch a strongest-tier final whole-change reviewer using `../implementation-work/prompts/final-reviewer.md` when the combined diff is larger or riskier than expected.
3. Apply only in-scope fixes required by final validation/review; re-run relevant checks and the affected review gate.
4. Stage only approved product/test/docs changes. Exclude `.agents/` artifacts by default.
5. Infer commit message conventions from project instructions and existing history.
6. Commit automatically after final validation passes. Do not ask for another approval.
7. Never include `Co-authored-by` trailers.
8. Record final commit SHA and validation evidence in the run log.

## Stop and Ask the User

Stop for user input only when:

- A required decision is outside the approved plan/DAG.
- A destructive, security-sensitive, migration, product, or architecture choice was not approved.
- TDD is required but impossible and no exception was approved.
- The repo state makes safe auto-commit impossible.
- The approved `quick-batch` route is no longer safe because per-task review gates or isolated worktrees are required.
- Subagents are unavailable.

## Final Response

Summarize:

- Plan artifact and quick run log path.
- DAG tasks completed.
- Whole-change review rounds and outcomes.
- Validation commands and outcomes.
- Final commit SHA.
- Any deferred risks or follow-up recommendations.
