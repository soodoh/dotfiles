---
name: heimdall-loop
description: Resolve Heimdall review, monitor the current GitHub PR's pipeline, and repeat until review is complete.
disable-model-invocation: true
compatibility: Requires git, an authenticated GitHub CLI (`gh`), access to the configured Azure DevOps MCP pipeline tools, and the sibling resolve-heimdall skill.
---

# Heimdall review loop

Drive the current branch's existing GitHub PR through Heimdall review cycles. This loop owns pipeline monitoring, pipeline failure triage, and repetition; [resolve-heimdall](../resolve-heimdall/SKILL.md) owns each comment-resolution pass. Read that skill before starting and follow its PR safety boundary, identity verification, comment filtering, mutation guardrails, and GitHub recipes throughout this workflow. Execute its instructions inline; no separate skill command or delegation is required.

## 1. Run one resolution pass

Run the complete [resolve-heimdall workflow](../resolve-heimdall/SKILL.md), including its final verification. If it reports no PR, an identity/safety blocker, or a required user decision, stop the loop and report that result. Its single-pass completion is a handoff to monitoring, not completion of this loop.

Retain the PR/host/repository/branch identity, verified Heimdall account, current head SHA, assessed comment IDs, dispositions and reply IDs/URLs, resolved thread IDs, validation results, commits, and push times. The pass may find no current comments; in that case, proceed to monitoring the existing head without an empty commit or push.

For monitoring scans, use [resolve-heimdall's GitHub recipes](../resolve-heimdall/references/github-graphql.md). Their `skill_dir` variable must point to the sibling `resolve-heimdall` directory, where the query files live, rather than this loop's directory.

## 2. Monitor the current head and respond to findings

After a push, use the PR head SHA and push time returned by the resolution pass. If the initial pass made no push, monitor the existing head; use its known push time, or the monitoring start time for the appearance bound when that time is unavailable. The GitHub Azure check may be absent until long after Azure has queued the build; its absence immediately after a push is **pending**, not a blocker. Use the last known PR check URL/build and repository pipeline configuration to identify the Azure DevOps project and pipeline definition. If no prior check exists, discover the definition from repository/PR metadata; stop only if the correct pipeline cannot be identified without guessing. Do not reuse an old run as evidence for the new head.

Prefer `azure-devops_pipelines_build` with `action: "list"`, filtering by the identified definition and `branchName: "refs/pull/<number>/merge"`. Inspect the returned `triggerInfo["pr.sourceSha"]` (and `triggerInfo["pr.number"]` when present) for an exact match to the current **GitHub PR head SHA**. Azure `sourceVersion` on a PR build can be the synthetic merge commit, so it is not an adequate head-SHA comparison. If several runs match, follow the latest queued run; a run for an older head never satisfies the wait. Once found, record its build ID, queue/start timestamps, and URL. Check the GitHub status only when helpful for correlation, not as the sole discovery mechanism.

Use a bounded, low-token wait in **two phases**. Each poll cycle checks both the matching Azure run and the PR's review threads: a running build is not evidence that Heimdall has not posted findings. Record Heimdall comment IDs already assessed or answered; fetch unresolved threads with pagination as in `resolve-heimdall` Step 1 and compare only verified Heimdall comment IDs to that set. New Heimdall comments interrupt the wait immediately, including while the build is queued or running. Comments solely from other reviewers do not restart the review cycle. Recheck the PR head before acting on them, then run another complete `resolve-heimdall` pass against the same PR. After a reply-only cycle, resume monitoring the same matching run; after a push, start over with the new head/run.

1. **Appearance:** allow an initial ~2-minute quiet period after the push, then check Azure and review threads about every ~2 minutes for the matching build or new Heimdall comments. At 15 minutes with no run, report a *delay* (not a failure) and keep checking Azure every ~5 minutes up to 60 minutes after the push, while continuing to check threads about every ~2 minutes. If still absent, investigate path filters, disabled PR triggers, API/permission issues, and pipeline health before reporting a missing-run blocker. Do not wait for a build if the actual changed paths are excluded from the PR trigger; explain that no run is expected.
2. **Execution:** once matched, check Azure and threads about every ~2 minutes. A queued build is still pending; queue-to-start delays of tens of minutes are possible. Determine Heimdall **stage** completion from the matching run's job-level evidence when available (for example, the Azure DevOps build timeline via existing authenticated access). An individual Heimdall job can finish while another Heimdall job or the stage remains pending, and comments can arrive later; do not treat that first job's success as the end of review. Use `azure-devops_pipelines_run` or `azure-devops_pipelines_build_log` only when needed to distinguish Heimdall from other stages. Once the Heimdall stage is terminal, recheck threads, then make one more thread scan after ~2 minutes to catch publication lag before declaring a clean run; new Heimdall comments at either scan enter the review cycle. If stage-level evidence is unavailable, wait for the **matching build's** terminal result as a conservative upper bound and say which signal was observed. At 2 hours after queueing, give a delayed-status update and investigate; at 3 hours, report the still-pending run and stop monitoring rather than claim completion.

Keep the Azure MCP read and the GitHub thread scan in the **same short cycle**, not in a long Azure-only batch. Use `gh api --hostname <host> graphql` for thread scans and the Azure DevOps MCP for pipeline reads; use a fallback Azure API only when the MCP cannot expose the needed job-level state. Between cycles a bounded `sleep` in `bash` spends no model tokens. If batching Azure reads in native Pi `codemode`, return within ~2 minutes so the next GitHub scan can interrupt promptly; a 10–15-minute build-only batch hides new reviews. Emit only changed state, run IDs, elapsed time, and the relevant stage/job result, not full build HTML or unchanged responses. Check the PR/head SHA at each cycle and before acting on a terminal result; stop if the branch advances unexpectedly.

### Pipeline failure triage

Classify failures as they appear, using the matching run's timeline, job/step logs, and pipeline `dependsOn`, `condition`, and `continueOnError` settings. The aggregate build result is not the Heimdall result: a failed build or `succeededWithIssues` job can still allow Heimdall to run. Check failed steps inside warning/non-blocking jobs as well as jobs marked failed.

- **Lint, unit test, or Playwright test failures:** investigate and fix the root cause even when the check is optional, uses `continueOnError`, or Heimdall still runs. Read the failing logs and available test reports; reproduce with the repository's authoritative commands when possible. Use `resolve-heimdall` Step 3 for the smallest safe repair, validation, commit, and push; this loop additionally permits the lint/test repairs identified here. Record the new head SHA and push time, then monitor that head's run. Do not suppress the check, weaken assertions, or dismiss an actual failure as a warning or flake. If a failure cannot be safely repaired (for example, unavailable test infrastructure or an ambiguous out-of-scope change), report the evidence and exact remaining blocker after investigation.
- **Unrelated warnings or failures:** record them separately and continue monitoring Heimdall and addressing its comments when they do not prevent its review job(s) from running. For example, a FOSSA failure is non-blocking for this workflow when Heimdall remains eligible to run or has run; the scanner's name alone does not establish whether it is blocking. Repairing unrelated checks is outside this workflow.
- **Failures that prevent Heimdall from running:** report a pipeline blocker only with evidence that the failure causes the required Heimdall review job(s) to be skipped or unable to run, such as a failed dependency and an unsatisfied job condition. A queued/pending job or an aggregate red build alone is not that evidence. If the dependency failure is a lint/test failure, take the repair path above first.

A failed/canceled Heimdall review job itself, or a skipped review whose cause remains unknown after investigation, leaves review completion unverified; report that specific problem rather than blaming an unrelated failed check. If job-level evidence is missing, retrieve the timeline/logs or pipeline conditions before classifying an aggregate failure. Do not infer successful review or a blocking dependency from the build summary alone.

Interpret terminal states carefully:

- A completed successful Heimdall stage (or matching build when stage evidence is unavailable), followed by the second clean thread scan, permits the final done-condition check. A failed aggregate build can also permit it when job-level evidence confirms the required Heimdall review job(s) completed successfully and triage shows only unrelated non-blocking failures.
- A completed run with review findings requires another review cycle after the findings are replied to and any fixes are pushed. If all findings are answered without code changes, its completed result can satisfy the wait; an empty commit is not needed.
- A failed run that clearly produced Heimdall comments is handled as a review cycle, while applying the failure triage above. Comments prove publication, not successful completion of every required Heimdall review job. If fixes are pushed, wait for a **new** run matching the new head before finishing.

Before finishing, inspect the matching run's lint, unit test, and Playwright results, including failing steps under warning/non-blocking jobs. If these checks are still pending after Heimdall finishes, keep monitoring them within the execution wait bounds; do not wait for unrelated jobs merely to obtain a green aggregate build. Recheck results after every pushed repair. A check skipped by intentional path/trigger configuration is not a test failure; a check skipped because of an earlier failure is not proof validation passed.

## 3. Repeat until the done condition is true

When new Heimdall comments appear during monitoring or a pass's final verification, run another complete `resolve-heimdall` pass immediately; do not wait for unrelated pipeline stages to finish. Recheck the PR/head and preserve the accumulated evidence across passes. After a reply-only pass, resume the same matching run; after any pushed fix or lint/test repair, monitor the new head's run using Step 2. A blocked pass stops the loop rather than retrying indefinitely.

After the Heimdall stage reaches a terminal state (or the build when stage evidence is unavailable), re-fetch the PR threads and status for the current head and honor the publication-lag scan from Step 2.

Finish only when all of these are true:

- the active branch still points to the intended PR;
- the latest relevant Heimdall review for the current PR head completed successfully using the evidence in Step 2, and the post-terminal thread scans (including publication lag) are clean;
- the current head's pipeline lint, unit test, and Playwright checks are accounted for, with no pending checks or unresolved failures (unless the user explicitly accepted a specific remaining failure); unrelated non-blocking failures do not prevent completion;
- there are no remaining unaddressed Heimdall comments from the latest review; and
- every resolution pass satisfies `resolve-heimdall`'s disposition and thread-resolution invariant.

If trigger/path configuration means no review run is expected, report that evidence and stop monitoring with review completion unverified; do not claim a successful Heimdall run.

Report the PR URL, commits pushed (if any), each Heimdall comment's disposition and reply, which Heimdall threads were resolved, the final Heimdall job/stage result separately from the aggregate pipeline result, validation commands/results and lint/test repairs, and any unrelated non-blocking failures left unchanged. Do not report dispositions for other reviewers' comments. Never report completion while any done-condition item is unverified.
