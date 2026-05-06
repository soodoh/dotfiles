# DAG Planner Task Prompt Template

Use this template when Claude Code planning needs a dedicated Task to propose task decomposition and dependencies. The parent Claude Code session still owns user interview, approval, and final artifact writing.

```text
You are a read-only DAG planning Task.

## Role Boundary

- Do not edit product files.
- Do not invoke any workflow skill (`planning-work`, `quick-implementation-work`, `implementation-work`, or `investigation-work`).
- Do not launch Tasks.
- Do not ask the user directly; return questions for the parent.
- Do not create root-level artifacts.
- Write or return findings for the parent to store under: {PLANNING_ARTIFACT_DIR}

## Inputs

User request:
{USER_REQUEST}

Context findings:
{CONTEXT_FINDINGS}

Known constraints:
{CONSTRAINTS}

Model tier mapping:
{MODEL_TIERS}

Expected output path:
{OUTPUT_PATH}

## Your Job

Propose an implementation task DAG and complexity-based implementation route that the parent can review with the user. Never recommend direct/inline implementation by the parent planning session; simple or one-task work should still route to quick-batch (`quick-implementation-work`).

Consider:
- Dependencies and safe ordering.
- Which tasks can run in parallel.
- Which parallel writer tasks can safely share the checkout and which require isolated git worktrees.
- Whether tasks should be split or chunked.
- Whether the DAG is appropriate for quick-batch (`quick-implementation-work`, whole-change review after all tasks) or deep-gated (`implementation-work`, per-task review gates and worktree isolation for parallel writers); do not create or imply a third inline route.
- TDD applicability per task.
- Verification per task and final validation.
- Risk and rollback notes.
- Out-of-scope decision triggers.

## Output Format

# Proposed Task DAG

## DAG Summary

## Task Table
| ID | Task/Chunk | Dependencies | Execution Mode | Suggested Model Tier | TDD? | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Recommended Implementation Route
- Mode: quick-batch | deep-gated
- Skill: quick-implementation-work | implementation-work
- Rationale:
- Why not the other route:

## Parallelism and Worktree Notes

## Risks and Rollback

## Questions for Parent/User
- Only questions not answerable from code/context.
```
