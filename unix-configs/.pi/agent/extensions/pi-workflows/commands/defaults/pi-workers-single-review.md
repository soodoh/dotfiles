---
description: Medium implementation with multiple workers where possible and one thorough final review over all changes.
argument-hint: <plan-path>
---
# Workers + Single Review

Split the plan into implementation tasks. Run multiple workers only for independent non-overlapping tasks; serialize overlapping tasks. If workers run in parallel, use git worktrees.

After all workers complete and changes are merged, run one thorough `review-gate` reviewer against the combined diff.

Rules:

- No per-task review by default.
- One combined review gate after all workers complete.
- If reviewer returns FAIL and fixes are within plan, run a fix worker and review again.
- Maximum rounds: 2.
- Escalate immediately for scope/product/architecture changes.
- Run focused validation before completion.
