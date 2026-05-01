---
description: Run final validation and produce a workflow summary.
argument-hint: <plan-path>
---

# Final Validation

Run the validation commands from the plan where possible. If unavailable, run the closest focused checks.

Summarize:

- what changed
- which plan tasks were completed
- validation run and results
- any skipped validation with reason
- follow-up recommendations

Then call `workflow_complete_run` with:

- `runId`: `$WORKFLOW_ID`
- `status`: `completed` if the approved plan is implemented and validation passed or only has documented non-blocking skips; otherwise `failed`
- `summary`: the concise validation summary
