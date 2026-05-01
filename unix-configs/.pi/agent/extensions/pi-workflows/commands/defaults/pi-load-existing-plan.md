---
description: Load an existing markdown plan artifact for execution.
argument-hint: <plan-path>
---
# Load Existing Plan

Read the markdown plan at `$ARGUMENTS` and confirm it contains enough information to execute.

If it is missing critical details, ask the user before proceeding. Otherwise summarize:

- plan path
- detected checklist items
- likely files/modules
- validation commands

End with a concise `PLAN_LOADED` summary.
