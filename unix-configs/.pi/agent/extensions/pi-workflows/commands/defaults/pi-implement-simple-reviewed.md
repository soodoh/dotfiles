---
description: Implement a simple plan with one worker subagent and one reviewer gate, looping up to 2 rounds.
argument-hint: <plan-path>
---
# Simple Reviewed Implementation

Use one `worker` subagent to implement all tasks in the plan. Then use one `review-gate` reviewer to inspect the full diff.

Rules:

- The worker must implement only the approved plan.
- The reviewer must be review-only.
- If reviewer returns FAIL and the fix is within the approved plan, run the worker again with exact reviewer findings.
- Maximum rounds: 2.
- Escalate immediately for scope/product/architecture changes.
- Run focused validation before completion.
