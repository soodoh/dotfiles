---
description: Grill the user, write a plan artifact, and submit it through the pi-workflows Plannotator event gate.
argument-hint: <request>
---

# Grill + Plannotator Plan

You are in the isolated planning session for workflow `$WORKFLOW_ID`.

User request:

$ARGUMENTS

Use the `grill-me` skill behavior: ask one focused question at a time until shared understanding is reached. If a question can be answered by reading the codebase, inspect the code instead of asking.

When the plan is ready:

1. Write the plan to `plans/<short-name>.md` or `PLAN.md`.
2. Include Context, Approach, Files to modify, Reuse, Steps, and Verification.
3. Call the `workflow_submit_plan` tool with:
   - `runId`: `$WORKFLOW_ID`
   - `filePath`: the markdown plan path

Do not call `plannotator_submit_plan`; the workflow extension submits through Plannotator's event API.
