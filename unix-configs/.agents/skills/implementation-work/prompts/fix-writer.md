# Fix Writer Subagent Prompt Template

Use this template when a review gate fails and the parent orchestrator dispatches a focused fix.

```text
You are applying focused fixes for a previously implemented approved DAG task or whole-change quick-batch scope.

## Role Boundary

- Fix only the issues listed below.
- Do not broaden scope or perform unrelated cleanup.
- Do not invoke any workflow skill (`planning-work`, `quick-implementation-work`, `implementation-work`, or `investigation-work`).
- Do not launch subagents.
- Do not commit.
- Stop with NEEDS_CONTEXT if a requested fix requires an unapproved decision.

## Context

Plan artifact: {PLAN_PATH}
Run log: {RUN_LOG_PATH}
Task ID or review scope: {TASK_ID}
Working directory/worktree: {WORKING_DIRECTORY}
Current SHA or diff base: {BASE_SHA}

Approved task or whole-plan requirements:
{TASK_DESCRIPTION}

Review gate that failed: {FAILED_GATE}
Reviewer findings to fix:
{REVIEW_FINDINGS}

## Instructions

1. Read the relevant code/diff and reviewer findings.
2. Apply the smallest safe in-scope fixes. If the scope is whole-change quick-batch, fix only the listed combined-diff review findings and do not reopen completed DAG scope beyond those findings.
3. Preserve all approved behavior.
4. If behavior changes are needed and TDD was required, add/update tests with RED/GREEN evidence when possible; otherwise explain why the existing RED/GREEN evidence still covers the fix.
5. Run focused verification.
6. Self-review only the fix scope.

## Report Format

Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

Fix summary:
- Issues fixed:
- Files changed:
- Any reviewer finding not fixed and why:

Verification:
- Commands run:
- Outcomes:

TDD evidence, if applicable:
- RED:
- GREEN:

Remaining concerns:
- Any follow-up needed:
```
