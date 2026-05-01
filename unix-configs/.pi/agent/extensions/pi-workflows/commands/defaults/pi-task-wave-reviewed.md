---
description: Complex implementation with dependency waves, worktree-isolated parallel workers, and per-task review gates.
argument-hint: <plan-path>
---
# Task Wave Reviewed Implementation

Extract checklist tasks from the plan and build dependency waves. Parallelize only non-overlapping tasks in the same wave. Parallel workers must use isolated git worktrees.

For each task:

1. Run a worker for that task only.
2. Run `review-gate` against that task's diff.
3. If FAIL and within plan, run a fix worker.
4. Repeat up to 4 rounds.
5. Merge only PASS-reviewed worktree changes back to the orchestrator branch.

After all waves merge, run one final integration review and final validation.

Escalate immediately for scope/product/architecture changes.
