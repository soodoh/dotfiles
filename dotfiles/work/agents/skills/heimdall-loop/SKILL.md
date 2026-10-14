---
name: heimdall-loop
description: Resolve Heimdall feedback and monitor the current GitHub PR's review jobs until review is complete, independently of other CI checks.
disable-model-invocation: true
compatibility: Requires git, an authenticated GitHub CLI (`gh`), access to the configured Azure DevOps MCP pipeline tools, and the sibling resolve-heimdall skill.
---

# Heimdall review loop

Drive the current branch's existing GitHub PR through Heimdall review cycles. This loop owns Heimdall job monitoring, recovery of review-blocking failures, and repetition; review completion is independent of overall CI or merge readiness. Report other CI checks as observed rather than waiting for or repairing them. [resolve-heimdall](../resolve-heimdall/SKILL.md) owns each comment-resolution pass, including local validation and required commit/push hooks. Read that skill before starting and follow its PR safety boundary, identity verification, comment filtering, mutation guardrails, and GitHub recipes throughout this workflow. Execute its instructions inline; no separate skill command or delegation is required.

Apply its **Recovery and continuity** policy throughout monitoring and resolution. This loop additionally permits minimal prerequisite repairs and safe retries needed for Heimdall to complete on the verified PR/head when their original execution context can be preserved. Verify the matching head and review results after recovery; retain this loop’s wait limits and done condition.

## 1. Run one resolution pass

Run the complete [resolve-heimdall workflow](../resolve-heimdall/SKILL.md), including its final verification. Stop and report any no-PR result, hard safety stop, or escalated blocker. Retain its handoff identity and evidence for monitoring; single-pass completion is not completion of this loop. If there are no current comments, monitor the existing head.

For monitoring scans, use [resolve-heimdall's GitHub recipes](../resolve-heimdall/references/github-graphql.md). Their `skill_dir` variable must point to the sibling `resolve-heimdall` directory, where the query files live, rather than this loop's directory.

## 2. Monitor the current head and respond to findings

After a push, use the PR head SHA and push time returned by the resolution pass. If the initial pass made no push, monitor the existing head; use its known push time, or the monitoring start time for the appearance bound when that time is unavailable. The GitHub Azure check may be absent until long after Azure has queued the build; its absence immediately after a push is **pending**, not a blocker. Use the last known PR check URL/build and repository pipeline configuration to identify the Azure DevOps project and pipeline definition. If no prior check exists, discover the definition from repository/PR metadata; stop only if the correct pipeline cannot be identified without guessing. Do not reuse an old run as evidence for the new head.

Prefer `azure-devops_pipelines_build` with `action: "list"`, filtering by the identified definition and `branchName: "refs/pull/<number>/merge"`. Inspect the returned `triggerInfo["pr.sourceSha"]` (and `triggerInfo["pr.number"]` when present) for an exact match to the current **GitHub PR head SHA**. Azure `sourceVersion` on a PR build can be the synthetic merge commit, so it is not an adequate head-SHA comparison. Order matching runs by queue time and follow the latest queued run; paginate build discovery as needed to establish which matching run is newest. A run for an older head never satisfies the wait. Once found, record its build ID, queue/start timestamps, and URL. Check the GitHub status only when helpful for correlation, not as the sole discovery mechanism.

Refresh matching-run discovery during every execution poll and immediately before declaring completion, even when the head SHA has not changed. A newer matching run supersedes the previously selected run; follow it instead of finishing against the older result. Also inspect the selected run's latest applicable Heimdall job attempts: an in-build job or stage retry supersedes the affected jobs' earlier results. Record each job's identity, attempt, state, result, and finish time from the timeline. On supersession, invalidate prior completion evidence and publication-grace scans for the superseded review, then observe the latest applicable attempts and perform fresh scans. Preserve valid comment dispositions and the workflow's wait limits. Pending or uncertain retry state cannot establish completion.

**Work first; wait only when idle.** Start or resume monitoring with an immediate Azure/thread scan. Before sleeping, check for actionable findings and whether completion can already be verified. Use a bounded `sleep` in `bash` only with no actionable work remaining, until the next review poll or publication-grace deadline, whichever is sooner. Calculate the remaining interval from recorded timestamps; investigation, validation, replies, and tool calls count toward elapsed time.

Each poll checks both Azure and review threads using `resolve-heimdall`'s filtering and disposition rules. Compare findings to valid completed dispositions, not merely seen or acknowledged IDs; revalidate dispositions when the head changes. Actionable Heimdall findings from monitoring or a pass's final verification trigger another complete resolution pass immediately, even while the build is queued, running, or failed. Recheck the PR/head before acting and preserve accumulated evidence. After a reply-only pass, resume the latest matching run/attempt without manufacturing another review; after any pushed fix or review-blocking prerequisite repair, monitor the new head. Published comments alone do not prove successful review.

Monitor in **two phases**:

1. **Appearance:** check Azure and threads about every ~2 minutes for the matching build or new Heimdall comments. At 15 minutes with no run, report a *delay* (not a failure) and keep checking Azure every ~5 minutes up to 60 minutes after the push, while continuing to check threads about every ~2 minutes. If still absent, investigate path filters, disabled PR triggers, API/permission issues, and pipeline health before reporting a missing-run blocker. Do not wait for a build if the actual changed paths are excluded from the PR trigger; explain that no run is expected.
2. **Execution:** while the build is queued or the remaining applicable Heimdall jobs are pending, check Azure and threads about every ~2 minutes; queue-to-start delays of tens of minutes are possible. While any Heimdall job is running, shorten the interval to ~30–60 seconds. At 2 hours after queueing, give a delayed-status update and investigate; at 3 hours, report the still-pending review and stop monitoring rather than claim completion.

### Review completion evidence and publication grace

Identify **all applicable Heimdall review jobs** from pipeline configuration and the matching run's timeline, including a separate later review stage when configured. A first successful job or review task is not enough while another applicable job or its latest attempt remains pending. Treat an intentionally excluded job as not applicable only with path/condition evidence; an unexplained or failure-induced skip leaves review unverified.

Use successful completion of those **jobs**, not their containing stages, as the review signal. A containing stage can include unrelated build or validation work; its pending/running state does not delay completion once every applicable Heimdall job succeeds. Inspect failed review steps under `succeededWithIssues` rather than treating a warning result or published comments as proof of successful review. Retrieve timeline/log evidence through the MCP, or an authenticated Azure API when the MCP cannot expose job/attempt state. If that evidence remains unavailable, report review completion unverified with the specific access/evidence blocker; aggregate build completion is not a substitute.

Once all applicable latest attempts succeed, scan threads immediately and record `reviewFinishedAt` as the latest of their job finish timestamps. The publication-grace deadline is `reviewFinishedAt + ~2 minutes`. Address findings immediately, then take a final clean thread scan at or after that deadline and perform Step 3's freshness checks. If the deadline already passed before monitoring began or while working, take the final scan without another sleep; scans need not be two minutes apart. When a finish timestamp is unavailable, use the time success was first observed for that attempt as the conservative anchor and report the limitation. A reply-only pass preserves this anchor; only a superseding run or review attempt resets the evidence. A clean scan means no actionable findings remain, not that the review originally published zero comments.

Use `gh api --hostname <host> graphql` for thread scans and the Azure DevOps MCP for pipeline reads; use a fallback Azure API only when the MCP cannot expose the needed job-level state. Keep both reads in the same short cycle; Azure-only batches in `codemode` must return within ~2 minutes so thread scans can interrupt promptly. Emit only changed state, run IDs, elapsed time, and the relevant stage/job result, not full build HTML or unchanged responses. Check the PR/head SHA at each cycle and before acting on a terminal result; stop if the branch advances unexpectedly.

### Review-blocking failure triage

Classify failures that affect Heimdall using the matching run's timeline, job/step logs, and pipeline `dependsOn`, `condition`, and `continueOnError` settings. The aggregate build result is not the Heimdall result: an aggregate red build alone does not establish a review blocker.

- **Failed/canceled review or unexplained skip:** investigate and apply the recovery policy to that specific review problem. Published comments do not establish successful execution.
- **Blocking prerequisite:** establish that the failure prevents an applicable Heimdall job from running or succeeding, such as a failed dependency with an unsatisfied job condition. Attempt the smallest safe recovery before escalating. If a lint/test repair is necessary for review to run, use `resolve-heimdall` Step 3 for diagnosis, the minimal repair, validation, commit, and push; monitor the resulting head. Preserve checks and assertions rather than bypassing them.
- **Other CI checks:** record pending/running checks and observed warnings/failures separately, including lint, unit, component, Playwright, deployment, and scanners. Their names or optional status alone do not determine whether they block review. When they do not prevent Heimdall from completing, leave them unchanged and continue toward review completion. Further CI monitoring or repair is separate work.

At final verification, report the other CI status available from the current reads, without waiting for pending checks or fetching unrelated logs/test reports solely to establish overall validation. A skipped or pending check is not a passed check.

## 3. Verify completion

After the publication-grace scans in Step 2, re-fetch the current PR/head and refresh matching-run discovery and applicable Heimdall job/attempt state. If a newer run or retry supersedes the observed review, return to Step 2 for fresh completion evidence and scans.

Finish only when all of these are true:

- the active branch still points to the intended PR;
- every applicable Heimdall job's latest attempt in the latest matching run for the current PR head completed successfully using the evidence in Step 2, the publication-grace thread scans are clean, and the final freshness check finds no superseding matching run or review retry;
- all actionable Heimdall findings in unresolved Heimdall-originated threads have valid completed dispositions, with no pending user decisions; reply-only resolutions count, and a review that originally produced zero findings is not required; and
- every resolution pass satisfies `resolve-heimdall`'s disposition and thread-resolution invariant.

If trigger/path configuration means no review run is expected, report that evidence and stop monitoring with review completion unverified; do not claim a successful Heimdall run.

Report the PR URL, commits pushed (if any), each Heimdall comment's disposition and reply, resolved Heimdall threads, the final matching build ID and Heimdall job/attempt identities and results, the publication-grace evidence, local validation commands/results and prerequisite repairs, and other CI status observed at final verification. Distinguish **Heimdall review complete** from **CI/merge readiness**: pending or failed non-review checks remain explicitly pending or failed, independently of review completion. If any review done-condition item remains unverified, report the specific pending state or blocker instead of completion.
