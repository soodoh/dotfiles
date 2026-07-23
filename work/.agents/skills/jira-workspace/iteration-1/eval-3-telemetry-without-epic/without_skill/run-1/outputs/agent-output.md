# Draft Jira Ticket

**Title:** Add telemetry for onboarding task completion latency

**Issue type:** Task

**Epic:** None

## Background

We currently lack reliable telemetry showing how long users take to complete individual onboarding tasks. This limits our ability to identify slow or confusing steps and to evaluate whether onboarding changes improve task completion time.

## Goal

Instrument onboarding task lifecycle data so task completion latency can be calculated and analyzed for each onboarding task, while preserving existing onboarding behavior and complying with current telemetry and privacy conventions.

## Scope

- Emit or extend telemetry for the point when an onboarding task becomes eligible for timing and the point when that same task is successfully completed.
- Include the data needed to correlate the start and completion of one task attempt and calculate elapsed time.
- Cover every task in the current onboarding flow that has an unambiguous successful-completion state.
- Use the repository's existing telemetry client, event taxonomy, shared context, and consent controls.
- Add automated tests for event emission, correlation, and important exclusion cases.
- Add or update telemetry documentation so downstream consumers understand the timing semantics.

## Requirements

### Timing semantics

- Define the start point as the earliest product state at which the user can act on the onboarding task, rather than page load or application launch, unless the existing telemetry contract specifies otherwise.
- Define the end point as the product-confirmed successful completion of that task.
- Use a monotonic elapsed-time source where available so wall-clock changes cannot produce invalid latency values.
- Record or provide enough correlated lifecycle data for elapsed time to be derived using the established telemetry pattern; do not create a new metric or event name without review from the telemetry owner.
- Ensure each successful task attempt contributes at most one completion observation.
- Do not report completion latency for tasks that are skipped, dismissed, abandoned, failed, or already complete when the flow is entered.
- Specify how retries, navigation away and back, application restarts, and repeated completion callbacks affect the timing window, following existing onboarding lifecycle behavior where possible.

### Event context

Use existing approved fields or dimensions for:

- Stable onboarding task identifier.
- Correlation identifier for the task attempt or onboarding session, if supported by the current telemetry model.
- Onboarding flow or version context, if already available.
- Completion outcome needed to distinguish successful completion from non-completion terminal states.
- Elapsed duration or timestamps required by the established telemetry design.

Do not include free-form user input, task content, direct identifiers, or new high-cardinality values. All emission must respect existing telemetry consent, opt-out, sampling, and redaction behavior.

### Reliability

- Instrument the authoritative task-state transition rather than a presentation-only interaction such as a button click.
- Avoid duplicate observations caused by rerenders, repeated callbacks, retries, or reopening a completed step.
- Do not block or delay task completion if telemetry initialization or delivery fails.
- Preserve current onboarding behavior and performance.

## Implementation Notes

1. Identify the shared onboarding task lifecycle or state transition used by all applicable tasks.
2. Identify the existing telemetry convention for paired lifecycle events or duration observations.
3. Add timing at the narrowest shared layer that can observe both task eligibility and confirmed success.
4. Reuse existing task identifiers and telemetry context rather than introducing parallel mappings.
5. Document the final event contract, field meanings, start/end semantics, and treatment of edge cases.
6. Confirm the proposed event or measurement naming with the telemetry owner before implementation; this ticket intentionally does not prescribe a metric name.

## Acceptance Criteria

- [ ] For every applicable onboarding task, telemetry supplies the approved data needed to calculate the elapsed time from task eligibility to confirmed successful completion.
- [ ] Start and completion records for a task attempt can be correlated using the existing approved telemetry model.
- [ ] A successfully completed task produces no more than one completion-latency observation, including when completion callbacks repeat or the completed task is revisited.
- [ ] Skipped, dismissed, abandoned, failed, and pre-completed tasks do not produce a successful completion-latency observation.
- [ ] Retry, navigation, and restart behavior is explicitly documented and covered by tests according to the agreed lifecycle semantics.
- [ ] Telemetry respects existing consent, opt-out, sampling, and redaction controls and contains no free-form user input or direct identifiers.
- [ ] Telemetry failures do not block, delay, or change onboarding task completion.
- [ ] Automated tests cover start emission or capture, successful completion, correlation, deduplication, and non-completion cases.
- [ ] The telemetry contract and timing semantics are documented and reviewed by the onboarding and telemetry owners.
- [ ] Validation in a non-production environment confirms the expected lifecycle data can be observed and used to derive a non-negative duration for a completed task, without asserting an invented latency threshold.

## Validation Plan

- Run unit tests for the onboarding lifecycle instrumentation and telemetry payload construction.
- Run integration tests that exercise at least one representative task from eligibility through confirmed completion.
- Exercise skip, dismissal, failure, retry, repeated callback, and revisit scenarios and verify no successful completion observation is emitted incorrectly.
- With telemetry debugging enabled in a non-production environment, verify the start and completion data use the same approved correlation context and contain only approved fields.
- Confirm a downstream query or approved telemetry inspection tool can derive completion latency from the captured data.
- Verify opt-out behavior prevents emission according to the existing telemetry policy.

## Out of Scope

- Defining dashboards, alerts, service-level objectives, latency targets, or performance thresholds.
- Renaming existing onboarding tasks or changing their user experience.
- Adding telemetry for unrelated onboarding funnel stages.
- Backfilling latency for historical onboarding sessions.

## Dependencies / Open Questions

- Telemetry owner approval of the event or measurement contract and final naming.
- Confirmation of the authoritative eligibility point for each task type.
- Confirmation of whether timing should survive application restarts or begin a new attempt, based on current lifecycle semantics and privacy constraints.
- Confirmation that all current onboarding tasks expose an unambiguous successful-completion transition; tasks that do not should be enumerated before implementation.

## Review Findings

- No code review findings apply because this is a draft-only Jira ticket and no source files were provided or inspected.
- The draft avoids prescribing metric names and numerical thresholds, as requested.

## Residual Risks

- Start-point, retry, and restart semantics require owner confirmation before implementation to prevent incomparable latency data.
- Existing telemetry correlation, consent, or sampling behavior may constrain the final event design.
- Some onboarding tasks may lack a shared authoritative completion transition and could require task-specific instrumentation.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The draft includes concrete review findings and residual risks in /Users/paul.diloreto/.agents/skills/jira-workspace/iteration-1/telemetry-without-epic/without_skill/outputs/agent-output.md; no source-code severity applies because this was a draft-only task with no input files."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/jira-workspace/iteration-1/telemetry-without-epic/without_skill/outputs/agent-output.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Draft includes implementation requirements, acceptance criteria, a validation plan, explicit exclusions, open questions, review findings, and residual risks.",
    "No Jira mutation was performed, no epic was assigned, and no metric names or latency thresholds were invented."
  ],
  "residualRisks": [
    "Timing lifecycle semantics and the final telemetry contract still require onboarding and telemetry owner confirmation.",
    "Applicability to tasks without a shared authoritative completion transition must be assessed during implementation."
  ],
  "noStagedFiles": true,
  "diffSummary": "Created one draft Jira ticket artifact; no repository source files or Jira issues were changed.",
  "reviewFindings": [
    "no blockers: no source files were provided or inspected; the artifact is a draft-only Jira ticket",
    "info: the draft intentionally leaves telemetry naming and numerical thresholds to owner review"
  ],
  "manualNotes": "The authoritative output path was used. The prohibited Jira skill file was not read or used."
}
```
