---
name: implementation-work
description: Use in pi when executing or resuming an approved `.agents/plans/` implementation plan artifact selected for deep-gated execution with pi subagents, per-task review gates, verification, and final auto-commit. Use this when the user says to continue, resume, pick up, or recover a long-running deep-gated implementation after context compaction.
---

# Implementation Work

Execute an approved plan+DAG artifact in pi using `subagent(...)`, per-task review gates, and final validation. This is the deep-gated implementer selected by `planning-work` for complex/high-risk work.

## Preconditions

Stop before writing if any precondition fails:

- The pi `subagent` tool/extension is available. If not, stop: this workflow requires pi subagents.
- The input is an approved `.agents/plans/*.md` artifact, or a `.agents/handoffs/*-implementation.md` file that points to one, with `Approval Status: approved`, an approval phrase of `approved`, `approve`, or `ship it`, and an approval timestamp. If missing, redirect to `planning-work`.
- The approved plan must contain an unambiguous `Complexity Assessment and Implementation Route` with both a selected mode and selected skill. If it clearly selects `quick-batch` / `quick-implementation-work`, stop and redirect to `quick-implementation-work` unless the user explicitly requests deep-gated execution and the plan is updated accordingly.
- For this skill to proceed, the route must clearly be `selected mode: deep-gated` and `selected skill: implementation-work`. If mode and skill conflict, route data is missing, or the handoff and plan disagree, stop and ask the user/planner to correct the artifact. Do not choose a route by inference.
- This skill is running in a fresh/minimal pi session context, not the same conversation that created the plan. If the planning conversation is still in context, stop and ask the user to clear context or open a new pi session with the handoff prompt.
- For a new run, the git working tree is clean before execution starts, ignoring `.agents/` workflow artifacts created by this workflow. On resume, expected uncommitted workflow changes may exist only when they match the latest run log and base SHA; unrelated non-`.agents/` changes are blocking.
- The approved plan contains a task DAG, verification policy, model tier mapping, and out-of-scope decision triggers.

Work on the current branch; do not stop merely because it is `main` or `master`.

## Pi Runtime Rules

- Dispatch every writer, reviewer, and fixer with pi `subagent(...)`, using the role prompt templates below and model overrides when available.
- For parallel writers, prefer isolated git worktrees; use pi `worktree: true` only when it matches the approved DAG and current repo state.
- Prefer `pi --list-models` for model inventory and tier substitutions.
- Run only from a fresh/minimal pi session containing the handoff prompt and approved artifacts.
- The parent orchestrator loads/activates `investigation-work` when diagnosis is needed; do not delegate workflow orchestration to a child subagent.
- Use pi `ask_user` when a required out-of-scope decision must be escalated to the user.
- If the run becomes unusually long, Ralph Wiggum can be used for pacing/checkpoints, but normal implementation does not require it.

Child subagents must not invoke any workflow skill (`planning-work`, `quick-implementation-work`, `implementation-work`, or `investigation-work`) and must not launch subagents. The parent orchestrator owns skill routing, the DAG, run log, review gates, retries, and final commit.

## Canonical Role Prompt Templates

Use the prompt templates in `prompts/` for every pi subagent dispatch. These templates are the source of truth for pi implementation roles; fill their placeholders from the approved plan, run log, and current task.

| Role                     | Template                           | When to use                                                 |
| ------------------------ | ---------------------------------- | ----------------------------------------------------------- |
| Implementer/writer       | `prompts/implementer.md`           | Initial implementation for a DAG task or chunk              |
| Spec/acceptance verifier | `prompts/spec-verifier.md`         | First review gate after implementer reports completion      |
| Code-quality reviewer    | `prompts/code-quality-reviewer.md` | Second review gate after spec verification passes           |
| Fix writer               | `prompts/fix-writer.md`            | Focused fixes after a failed review gate                    |
| Final reviewer           | `prompts/final-reviewer.md`        | Whole-change review before final validation and auto-commit |

Pass the filled template as the pi `subagent(...)` task prompt and choose the agent/model tier according to this skill. Do not improvise shorter role prompts unless the template is clearly inapplicable; if you must adapt, preserve the role boundary, stop rules, TDD evidence requirements, and output format.

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
- Worktree paths and integration status.
- Final validation result and final commit SHA.
- A current `## Resume Snapshot` block using the template below.

Keep `.agents/runs/ACTIVE.md` updated while the implementation is unfinished. It should contain the active run log path, plan path, selected mode, selected skill, branch, base SHA, current phase, and next action. Remove or mark it complete after the final commit is recorded.

Use this exact run-log block and refresh it after every significant step:

```md
## Resume Snapshot

- Selected skill: implementation-work
- Selected mode: deep-gated
- Plan path:
- Handoff path:
- Run log path:
- Branch:
- Base SHA:
- Current phase:
- Last completed action:
- Next action:
- Current DAG node:
- Completed DAG nodes:
- Blocked DAG nodes:
- Pending review/fix loop:
- Expected changed files:
- Active subagent IDs:
- Worktree paths:
- Verification already run:
- Resume prompt: Use `implementation-work`, read this run log and the approved plan, verify route/state, then continue from `Next action`.
```

On resume, read the approved plan and latest run log, verify the git state against the recorded base SHA and expected changed files, re-check model availability, then continue from the first incomplete DAG node. Resume may continue expected uncommitted workflow diffs, but stop on unrelated changes, route mismatches, or missing run-log evidence. Do not duplicate completed work unless validation shows it is invalid.

## Compaction / Resume Bootstrap

When context is compacted, thin, or the user says “continue”, “resume”, “pick up where you left off”, or similar, treat this as a resume, not a new implementation:

1. Do not rely on conversation memory. Reconstruct state only from `.agents/` artifacts and git state.
2. Read `.agents/runs/ACTIVE.md` if present. If absent, inspect `.agents/runs/` for the latest incomplete run log for this repository.
3. If exactly one plausible active run exists, use it. If multiple plausible incomplete runs exist, ask the user which run log to resume.
4. Read the run log's `## Resume Snapshot`, referenced approved plan, and handoff file when present.
5. Verify the route still matches this skill: selected mode `deep-gated` and selected skill `implementation-work`. If the artifacts select `quick-batch` / `quick-implementation-work`, stop and redirect to that skill instead of continuing here.
6. Verify git branch, base SHA, expected changed files, worktree paths, and active/finished subagent evidence against the run log. Stop on unrelated changes or missing evidence that makes safe continuation impossible.
7. Re-check model availability and record any substitutions in the run log.
8. Rebuild parent progress tracking from the run log and approved DAG: completed nodes stay complete, blocked nodes stay blocked, and execution resumes from the first incomplete node or the recorded review/final-validation phase.
9. Before dispatching new subagents, record the resume decision and refreshed `## Resume Snapshot` in the run log.

After any non-final checkpoint response, include the run log path and the resume prompt from the snapshot so a future compacted session can restart reliably.

## Execution Process

### 1. Prepare

1. Read the handoff file if provided, then read the approved plan artifact.
2. Confirm this is a fresh/minimal pi implementation session. Do not rely on prior planning conversation context; rely on the approved artifact and handoff file.
3. Verify git state with `git status --porcelain --untracked-files=all`: for new runs, treat any non-`.agents/` change as blocking; for resumes, allow only run-log-matching workflow diffs. Treat staged `.agents/` files as blocking before commit and record ignored `.agents/` paths in the run log.
4. Record base SHA.
5. Re-check model tiers.
6. Create/update the run log.
7. Topologically sort the task DAG.

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
- Fill `prompts/implementer.md` with the task text, relevant context, files/areas, TDD requirement, verification expectations, stop rules, and report format.

**Implement**

- Dispatch exactly one writer subagent per task/chunk/worktree using the filled `prompts/implementer.md` template.
- Writer must not recursively invoke any workflow skill or launch subagents.
- Writer must stop for out-of-scope decisions, unclear requirements, or unsafe/destructive changes.
- For behavior-changing code, writer must follow the approved TDD policy. If TDD is required, report RED/GREEN evidence: failing test command/output summary before production code, passing command/output after implementation.
- If an approved non-TDD exception exists, writer must report that exception and explicit verification evidence.

Writer report statuses:

| Status               | Meaning                   | Parent action                                         |
| -------------------- | ------------------------- | ----------------------------------------------------- |
| `DONE`               | Implemented and verified  | Start review gates                                    |
| `DONE_WITH_CONCERNS` | Implemented but uncertain | Read concerns; investigate if correctness/scope risk  |
| `NEEDS_CONTEXT`      | Missing info              | Provide context or invoke `investigation-work`        |
| `BLOCKED`            | Cannot complete           | Invoke `investigation-work` or escalate with evidence |

**Verify**
Run two independent review gates before marking complete:

1. **Spec/acceptance verifier:** use `prompts/spec-verifier.md`; independently reads the code/diff and checks that the task matches the approved spec, with nothing missing and no unapproved extras.
2. **Code-quality reviewer:** use `prompts/code-quality-reviewer.md`; runs only after spec/acceptance passes and checks maintainability, simplicity, tests, project conventions, and risk.

If a reviewer finds issues, send `prompts/fix-writer.md` as a focused fix prompt to a writer subagent. Re-run the same review gate. After two failed fix/review cycles for the same issue, invoke `investigation-work` once when diagnosis can help; if the issue remains unresolved or requires an out-of-scope decision, mark the task `BLOCKED` and escalate to the user with evidence.

Reviewer must reject TDD-required work if RED/GREEN evidence is missing.

### 4. Investigation on Blockers

Invoke `investigation-work` when:

- A writer reports `BLOCKED` or `NEEDS_CONTEXT` and local context is insufficient.
- The same review issue fails twice.
- Verification fails repeatedly without clear cause.
- A suspected root cause requires diagnosis before more implementation.

Pass the relevant plan path, run log path, task ID, failure evidence, commands, and changed files. Investigation findings may update the run log, but implementation must stay within approved scope.

### 5. Integrate Parallel Worktrees

Parallel worktrees must use one explicit integration method:

- **Patch mode:** writers leave uncommitted changes; after review gates pass, the parent exports `git diff --binary` from the task worktree and applies it sequentially to the main checkout.
- **Task-commit mode:** only the parent, not writer subagents, may create temporary task commits on task branches after gates pass; the parent merges or cherry-picks them sequentially and may squash/finalize according to the plan.

Record the selected method, task branch/path, base SHA, and integration result in the run log. Do not say “merge worktrees” unless task commits/branches exist.

When parallel worktrees were used:

1. Integrate completed worktrees sequentially in DAG/topological order using the recorded integration method.
2. Run affected validation after each integration.
3. If conflicts occur, dispatch an implementation subagent to resolve within approved scope.
4. Re-run the affected spec and quality gates after conflict resolution.

### 6. Final Validation and Auto-Commit

After all DAG nodes pass:

1. Run targeted checks, then affected suites, then broader checks when risk justifies it.
2. Dispatch a strongest-tier final whole-change reviewer using `prompts/final-reviewer.md`.
3. Apply only in-scope fixes required by final review; re-run relevant gates. Limit final review/fix to two rounds, then invoke `investigation-work` once if diagnosis may help; if unresolved, stop as `BLOCKED` with evidence.
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
