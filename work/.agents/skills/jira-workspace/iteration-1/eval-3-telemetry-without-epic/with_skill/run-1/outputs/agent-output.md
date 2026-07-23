Draft only; no Jira item was created or updated.

**Proposed Jira Ticket**

- Project: `OB` (Onboarding)
- Type: `Task`
- Summary: Add telemetry for onboarding task completion latency
- Assignee: Current user (`me`)
- Sprint: `2026-14` (active sprint, ID `54875`)
- Epic: None (not requested)

## Context

We need visibility into how long onboarding tasks take to complete so engineers and product stakeholders can evaluate completion latency across the onboarding experience. Current telemetry coverage and naming are not specified in this request, so implementation must follow the repository's existing telemetry conventions rather than introducing an unreviewed metric name or performance threshold.

## Scope

- Identify the authoritative start and completion points for an onboarding task and document the latency definition used by the instrumentation.
- Emit completion-latency telemetry when an onboarding task transitions to completed, using the existing telemetry library, naming conventions, units, and dimensional model.
- Include only established, low-cardinality dimensions needed to distinguish relevant onboarding task categories or completion paths.
- Ensure retries, duplicate completion signals, refreshes, or repeated state processing do not produce misleading duplicate observations for the same completion transition.
- Handle missing or invalid start timestamps safely: do not emit a fabricated or negative duration, and preserve the task-completion behavior if telemetry fails.
- Apply the project's existing privacy and data-classification requirements; do not include user-entered content, direct identifiers, or other sensitive values in telemetry.
- Add or update the relevant telemetry documentation, schema/registration, dashboard/query definition, or catalog entry required by the existing observability workflow.
- Do not define a new metric name, alert, SLO, or latency threshold as part of this draft; select names and operational thresholds through the established telemetry review process.

## Acceptance criteria

- A successful onboarding task completion records a latency observation derived from the agreed task start and completion timestamps.
- The emitted observation uses an approved existing telemetry convention for name, unit, aggregation, and dimensions; the implementation or review record documents those choices.
- Each logical transition to completed produces at most one observation, including when completion processing is retried or replayed.
- Abandoned, cancelled, incomplete, or failed tasks do not emit a successful task-completion latency observation unless the existing telemetry contract explicitly defines those states as completion.
- Missing, malformed, future-dated, or otherwise invalid start timestamps do not result in a fabricated or negative latency observation and do not block task completion.
- Telemetry emission failures do not change the user-visible completion outcome.
- Dimensions are bounded and contain no user-entered content, direct identifiers, or sensitive data.
- Automated tests cover successful completion, duplicate/replayed completion, non-completion states, invalid or missing timestamps, and telemetry-emission failure.
- The resulting telemetry is verified in the supported local or non-production observability path, including the recorded unit and expected dimensions, without asserting a new latency threshold.

## Validation

- Run the affected unit and integration test suites.
- Trigger a representative onboarding task from its authoritative start through successful completion in a supported test environment and confirm one latency observation is available through the existing telemetry inspection path.
- Repeat or replay completion processing and confirm no additional observation is recorded for the same logical transition.
- Exercise missing and invalid start-time cases and confirm no invalid observation is emitted and completion remains functional.
- Force or mock a telemetry-client failure and confirm onboarding task completion remains successful.
- Inspect emitted dimensions to verify cardinality and privacy constraints.

**Proposed Commands (Not Executed)**

The installed create command defaults descriptions to HTML and does not advertise `--description-format`; use a two-step create/update flow so the full description is explicitly parsed as Markdown. Replace `<DESCRIPTION>` with the ticket body above, passed via argument-safe file/heredoc handling, and use the issue key returned by create:

```bash
twg jira workitem create \
  --space OB \
  --type Task \
  --summary "Add telemetry for onboarding task completion latency" \
  --assignee me

twg jira workitem update \
  --id <RETURNED_ISSUE_KEY> \
  --description "<DESCRIPTION>" \
  --description-format markdown \
  --sprint 54875
```

**Review Findings**

- No blockers: `/Users/paul.diloreto/.agents/skills/jira-workspace/iteration-1/telemetry-without-epic/with_skill/outputs/agent-output.md` contains a self-contained implementation and validation draft without invented metric names or thresholds.

**Residual Risks**

- The repository/service instrumentation points were not supplied, so the authoritative start event, completion transition, telemetry convention, and exact test file paths must be confirmed during implementation.
- Active sprint `2026-14` is mutable and must be re-resolved if this draft is later executed.
- The exact telemetry backend may impose schema, registration, sampling, or idempotency requirements not discoverable from the request alone.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The Review Findings and Residual Risks sections provide a concrete artifact path, blocker status, and implementation-specific risks."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/jira-workspace/iteration-1/telemetry-without-epic/with_skill/outputs/agent-output.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short",
      "result": "passed",
      "summary": "Inspected the working tree without modifying repository files."
    },
    {
      "command": "twg help describe jira workitem create; twg help describe jira workitem update; twg help describe jira board query; twg help describe jira board sprints query; twg help describe jira workitem field create-metadata",
      "result": "passed",
      "summary": "Verified live read/write command contracts; no mutation command was executed."
    },
    {
      "command": "twg jira space get OB; twg jira board query --project OB --type scrum; twg jira board sprints query --id 473 --current; twg jira workitem field create-metadata --space OB --type Task --output json",
      "result": "passed",
      "summary": "Verified OB supports Task, resolved its sole Scrum board and sole active sprint 2026-14 (ID 54875), and inspected create metadata."
    }
  ],
  "validationOutput": [
    "OB is the Onboarding software project and supports the Task issue type.",
    "Onboarding Scrum Board (ID 473) is the sole returned OB Scrum board.",
    "Sprint 2026-14 (ID 54875) is the sole returned active sprint.",
    "No Jira create or update mutation was performed."
  ],
  "residualRisks": [
    "Instrumentation points and telemetry conventions require repository-specific confirmation during implementation.",
    "The active sprint must be re-resolved before any later mutation.",
    "Backend-specific schema, sampling, and idempotency requirements remain unknown."
  ],
  "noStagedFiles": true,
  "diffSummary": "Created only the required evaluation output containing a draft OB Task, proposed non-executed commands, review findings, and residual risks.",
  "reviewFindings": [
    "no blockers: /Users/paul.diloreto/.agents/skills/jira-workspace/iteration-1/telemetry-without-epic/with_skill/outputs/agent-output.md - Draft is self-contained and does not invent metric names or thresholds."
  ],
  "manualNotes": "Draft-only request honored. No epic is proposed because none was requested. No Jira mutation occurred."
}
```
