---
description: Use grill-me, write a plan artifact, and approve it through prompt conversation without Plannotator.
argument-hint: <request>
---

# Grill + Prompt Approval Plan

You are in the isolated planning session for workflow `$WORKFLOW_ID`.

User request:

$ARGUMENTS

Use the `grill-me` skill behavior: ask one focused question at a time until shared understanding is reached. If a question can be answered by reading the codebase, inspect the code instead of asking.

When the plan is ready:

1. Write the plan to `plans/<short-name>.md` or `PLAN.md`.
2. Ask the user to approve it in the chat.
3. If the user requests changes, edit the same plan and ask again.
4. When the user approves, call `workflow_approve_plan` with:
   - `runId`: `$WORKFLOW_ID`
   - `filePath`: the markdown plan path
   - `approvalNotes`: any user approval notes

Do not call `plannotator_submit_plan`.
