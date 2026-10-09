---
name: heimdall-loop
description: Resolve Heimdall review, monitor the current GitHub PR's pipeline, and repeat until review is complete.
disable-model-invocation: true
compatibility: Requires git, an authenticated GitHub CLI (`gh`), access to the configured Azure DevOps MCP pipeline tools, and the sibling resolve-heimdall skill.
---

# Heimdall review loop

Drive the current branch's existing GitHub PR through Heimdall review cycles. This loop owns pipeline monitoring, pipeline failure triage, and repetition; [resolve-heimdall](../resolve-heimdall/SKILL.md) owns each comment-resolution pass. Read that skill before starting and follow its PR safety boundary, identity verification, comment filtering, mutation guardrails, and GitHub recipes throughout this workflow. Execute its instructions inline; no separate skill command or delegation is required.

Apply its **Recovery and continuity** policy throughout monitoring and resolution. This loop additionally permits the lint/test repairs described below and safe retries of existing pipeline checks for the verified PR/head when their original execution context can be preserved. Verify the matching head and review results after recovery; retain this loop’s wait limits and done condition.

## 1. Run one resolution pass

Run the complete [resolve-heimdall workflow](../resolve-heimdall/SKILL.md), including its final verification. Stop and report any no-PR result, hard safety stop, or escalated blocker. Retain its handoff identity and evidence for monitoring; single-pass completion is not completion of this loop. If there are no current comments, monitor the existing head.

For monitoring scans, use [resolve-heimdall's GitHub recipes](../resolve-heimdall/references/github-graphql.md). Their `skill_dir` variable must point to the sibling `resolve-heimdall` directory, where the query files live, rather than this loop's directory.

## 2. Monitor the current head and respond to findings

After a push, use the PR head SHA and push time returned by the resolution pass. If the initial pass made no push, monitor the existing head; use its known push time, or the monitoring start time for the appearance bound when that time is unavailable. The GitHub Azure check may be absent until long after Azure has queued the build; its absence immediately after a push is **pending**, not a blocker. Use the last known PR check URL/build and repository pipeline configuration to identify the Azure DevOps project and pipeline definition. If no prior check exists, discover the definition from repository/PR metadata; stop only if the correct pipeline cannot be identified without guessing. Do not reuse an old run as evidence for the new head.

Prefer `azure-devops_pipelines_build` with `action: "list"`, filtering by the identified definition and `branchName: "refs/pull/<number>/merge"`. Inspect the returned `triggerInfo["pr.sourceSha"]` (and `triggerInfo["pr.number"]` when present) for an exact match to the current **GitHub PR head SHA**. Azure `sourceVersion` on a PR build can be the synthetic merge commit, so it is not an adequate head-SHA comparison. Order matching runs by queue time and follow the latest queued run; paginate build discovery as needed to establish which matching run is newest. A run for an older head never satisfies the wait. Once found, record its build ID, queue/start timestamps, and URL. Check the GitHub status only when helpful for correlation, not as the sole discovery mechanism.

Refresh matching-run discovery during every execution poll and immediately before declaring completion, even when the head SHA has not changed. A newer matching run supersedes the previously selected run; follow it instead of finishing against the older result. Also inspect the selected run's latest required Heimdall stage/job attempts: an in-build retry supersedes that job's earlier result. Record attempt identity and state from the timeline when available. On supersession, invalidate prior terminal evidence and publication-lag scans for the superseded review, then observe the latest required attempts and perform fresh post-terminal scans. Preserve valid comment dispositions and the workflow's wait limits. If attempt-level evidence is unavailable, use a fresh matching-build terminal result conservatively and report that limitation; pending or uncertain retry state cannot establish completion.

**Work first; wait only when idle.** Use a bounded `sleep` in `bash` only while waiting for Heimdall comments or pipeline progress with no actionable work remaining. Start or resume monitoring with an immediate Azure/thread scan. Count time spent working toward polling and publication-lag intervals; wait only for any remaining interval.

Each poll checks both Azure and review threads using `resolve-heimdall`'s filtering and disposition rules. Compare findings to valid completed dispositions, not merely seen or acknowledged IDs; revalidate dispositions when the head changes. Actionable Heimdall findings from monitoring or a pass's final verification trigger another complete resolution pass immediately, even while the build is queued, running, or failed. Recheck the PR/head before acting and preserve accumulated evidence. After a reply-only pass, resume the latest matching run/attempt without manufacturing another review; after any pushed fix or lint/test repair, monitor the new head. Published comments alone do not prove successful review.

Monitor in **two phases**:

1. **Appearance:** check Azure and threads about every ~2 minutes for the matching build or new Heimdall comments. At 15 minutes with no run, report a *delay* (not a failure) and keep checking Azure every ~5 minutes up to 60 minutes after the push, while continuing to check threads about every ~2 minutes. If still absent, investigate path filters, disabled PR triggers, API/permission issues, and pipeline health before reporting a missing-run blocker. Do not wait for a build if the actual changed paths are excluded from the PR trigger; explain that no run is expected.
2. **Execution:** once matched, check Azure and threads about every ~2 minutes. A queued build is still pending; queue-to-start delays of tens of minutes are possible. Determine Heimdall **stage** completion from the matching run's job-level evidence when available (for example, the Azure DevOps build timeline via existing authenticated access). An individual Heimdall job can finish while another Heimdall job or the stage remains pending, and comments can arrive later; do not treat that first job's success as the end of review. Use `azure-devops_pipelines_run` or `azure-devops_pipelines_build_log` only when needed to distinguish Heimdall from other stages. Once the Heimdall stage is terminal, scan threads, then scan again at least ~2 minutes after that scan to catch publication lag. A clean scan means no actionable findings remain, not that the review originally published zero comments. If stage-level evidence is unavailable, wait for the **matching build's** terminal result as a conservative upper bound and say which signal was observed. At 2 hours after queueing, give a delayed-status update and investigate; at 3 hours, report the still-pending run and stop monitoring rather than claim completion.

Use `gh api --hostname <host> graphql` for thread scans and the Azure DevOps MCP for pipeline reads; use a fallback Azure API only when the MCP cannot expose the needed job-level state. Keep both reads in the same short cycle; Azure-only batches in `codemode` must return within ~2 minutes so thread scans can interrupt promptly. Emit only changed state, run IDs, elapsed time, and the relevant stage/job result, not full build HTML or unchanged responses. Check the PR/head SHA at each cycle and before acting on a terminal result; stop if the branch advances unexpectedly.

### Pipeline failure triage

Classify failures as they appear, using the matching run's timeline, job/step logs, and pipeline `dependsOn`, `condition`, and `continueOnError` settings. The aggregate build result is not the Heimdall result: a failed build or `succeededWithIssues` job can still allow Heimdall to run. Check failed steps inside warning/non-blocking jobs as well as jobs marked failed.

- **Lint, unit test, or Playwright test failures:** investigate and fix the root cause even when the check is optional, uses `continueOnError`, or Heimdall still runs. Read the failing logs and available test reports; reproduce with the repository's authoritative commands when possible. Use `resolve-heimdall` Step 3 for the smallest safe repair, validation, commit, and push, recording the new head SHA and push time. Do not suppress the check, weaken assertions, or dismiss an actual failure as a warning or flake.
- **Unrelated warnings or failures:** record them separately and continue monitoring Heimdall and addressing its comments when they do not prevent its review job(s) from running. For example, a FOSSA failure is non-blocking for this workflow when Heimdall remains eligible to run or has run; the scanner's name alone does not establish whether it is blocking. Repairing unrelated non-blocking checks is outside this workflow.
- **Failures that prevent Heimdall from running:** report a pipeline blocker only with evidence that the failure causes the required Heimdall review job(s) to be skipped or unable to run, such as a failed dependency and an unsatisfied job condition. A queued/pending job or an aggregate red build alone is not that evidence. Apply the recovery policy to the blocking prerequisite before escalating; if it is a lint/test failure, take the repair path above first.

A failed/canceled Heimdall review job, or a skipped review whose cause remains unknown after investigation, leaves completion unverified and requires recovery of that specific problem. When job-level evidence is missing, retrieve the timeline/logs or pipeline conditions before classifying an aggregate failure.

Before finishing, inspect the matching run's lint, unit test, and Playwright results, including failing steps under warning/non-blocking jobs. If these checks are still pending after Heimdall finishes, keep monitoring them within the execution wait bounds; do not wait for unrelated jobs merely to obtain a green aggregate build. Recheck results after every pushed repair. A check skipped by intentional path/trigger configuration is not a test failure; a check skipped because of an earlier failure is not proof validation passed.

## 3. Verify completion

After the post-terminal scans and validation accounting in Step 2, re-fetch the current PR/head and refresh matching-run discovery and required review-attempt state. If a newer run or retry supersedes the observed review, return to Step 2 for fresh completion evidence and scans.

Finish only when all of these are true:

- the active branch still points to the intended PR;
- the latest matching run's required Heimdall review attempts for the current PR head completed successfully using the evidence in Step 2, the post-terminal thread scans (including publication lag) are clean, and the final freshness check finds no superseding matching run or review retry;
- the current head's pipeline lint, unit test, and Playwright checks are accounted for, with no pending checks or unresolved failures (unless the user explicitly accepted a specific remaining failure); unrelated non-blocking failures do not prevent completion;
- all actionable Heimdall findings in unresolved Heimdall-originated threads have valid completed dispositions, with no pending user decisions; reply-only resolutions count, and a review that originally produced zero findings is not required; and
- every resolution pass satisfies `resolve-heimdall`'s disposition and thread-resolution invariant.

If trigger/path configuration means no review run is expected, report that evidence and stop monitoring with review completion unverified; do not claim a successful Heimdall run.

Report the PR URL, commits pushed (if any), each Heimdall comment's disposition and reply, which Heimdall threads were resolved, the final matching build ID and observed Heimdall attempt identities, the final Heimdall job/stage result separately from the aggregate pipeline result, validation commands/results and lint/test repairs, and any unrelated non-blocking failures left unchanged. If any done-condition item remains unverified, report the specific pending state or blocker instead of completion.
