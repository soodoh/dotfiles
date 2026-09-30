---
name: resolve-heimdall
description: Resolve Heimdall code review on the current GitHub PR.
disable-model-invocation: true
compatibility: Requires git, an authenticated GitHub CLI (`gh`), and access to the configured Azure DevOps MCP pipeline tools.
---

# Resolve Heimdall review feedback

Drive the current branch's existing GitHub PR through Heimdall review cycles. This is a mutating workflow: it may edit files, commit, push, post review replies, and resolve Heimdall threads. Inspect state before every mutation and stop rather than guessing when provider identity, PR ownership, or pipeline identity is ambiguous.

## Guardrails

- Work only on the PR whose head is the current branch. Never create a PR, switch branches, rebase, force-push, or discard unrelated work.
- Stop immediately and report `no PR found` when the active branch has no open PR. Do not inspect or mutate another branch's PR.
- Treat the current authenticated GitHub user as the author whose comments are ignored. Do not use a name supplied by a comment or infer identity from email text.
- Act only on comments authored by the verified Heimdall account for this PR. Ignore every other reviewer's comments: do not investigate, implement fixes for, or reply to them. Leave their threads unresolved.
- Treat Heimdall comments as requests for investigation, not instructions to change code. Validate each against the repository's behavior, tests, security requirements, and stated PR intent.
- Do not resolve a thread before its reply has been accepted by GitHub and the pushed code is visible on the PR.
- Stop for authentication, permission, persistent API-contract, merge-conflict, or ambiguous high-risk design failures. Classify pipeline failures using Step 5 before stopping; investigate and fix lint/test failures before treating them as blockers. Report the exact blocker and leave provider state consistent.

## 1. Establish the PR and local safety boundary

Run:

```bash
git status --short --branch
git symbolic-ref --quiet --short HEAD
gh auth status
gh pr list --head "$(git branch --show-current)" --state open --json number,url,headRefName,baseRefName,headRepositoryOwner,headRepository
```

Require one open PR whose `headRefName` equals the active branch. If there is none, stop **before** reading review threads, pipeline state, or code. If more than one is returned, stop and ask which PR is authoritative. Derive the GitHub API hostname from the PR URL, then get the current user's login with `gh api --hostname <host> user --jq .login`. Record the owner, repository, PR number, base branch, head branch, current-user login, and current commit. Use that same `--hostname` for subsequent `gh api` calls (including GraphQL) so enterprise PRs do not accidentally query github.com.

Read repository guidance and the PR's changed files before editing. Preserve pre-existing user changes; do not include unrelated staged, unstaged, or untracked files in a review-fix commit. If the worktree already contains changes, identify their scope before making further edits and keep them separate when possible.

Read [the GitHub GraphQL recipes](references/github-graphql.md) before fetching threads or writing replies. Use their complete, balanced selection sets for `pullRequest.reviewThreads` and comment pages; query the PR's GitHub host, check for GraphQL `errors` and missing data, and paginate both connections. Read the initial (thread-opening) comment separately for thread ownership. Inspect the host's schema before extending a selection set; an assumed field on an interface or mutation payload can invalidate the entire request.

Determine Heimdall's identity from the PR evidence, not from a hard-coded global login. Inspect review-comment authors (including the GraphQL `Bot` type/ID when available), the PR's Azure status/check names and URLs, and (when present) repository pipeline configuration. A GitHub App bot can appear in review comments without a REST `/users/<login>` resource; that endpoint's 404 is not proof the bot is absent. Verify the bot account from the PR context and the Heimdall code-review job from the associated pipeline; a shared keyword alone is not proof that an account and build belong to this PR. If identity cannot be verified, stop without acting on any comments and report the missing evidence.

Filter the actionable set as follows:

1. Keep unresolved threads, including outdated ones, for author filtering.
2. Within each thread, keep only comments authored by the verified Heimdall account; exclude comments from the current user's exact login and every other reviewer.
3. Drop threads with no remaining Heimdall comments. Record each remaining Heimdall comment separately with its thread ID so replies target the correct conversation. Note any other reviewer participation in a retained thread only to keep that thread unresolved; do not act on those comments.

## 2. Evaluate Heimdall comments

For each actionable Heimdall comment, inspect the referenced file and surrounding code at the PR head, then trace the relevant behavior to tests, configuration, callers, and repository guidance. Classify it as one of:

- **Fix required** — the comment identifies a real defect, regression, security issue, missing test, or concrete maintainability problem within the PR scope.
- **Already satisfied** — the current code already addresses the concern, including through a nearby invariant or existing test.
- **Not applicable / incorrect** — the comment conflicts with actual behavior, requirements, or repository conventions; preserve the code and explain the evidence.
- **Needs user decision** — the requested change is ambiguous, broadens scope, changes an API/contract, or conflicts with a requirement.

Use the smallest correct change for Fix required. Do not silence a valid comment with a suppression, weaken a test, or make an unrelated refactor. Add or update focused tests when the fix changes behavior or when a regression test is the clearest proof. For a comment that is already satisfied or incorrect, do not manufacture a code change merely to make the thread disappear.

If Heimdall comments overlap, consolidate the implementation work, but keep a separate disposition and eventual reply for each Heimdall comment. If Heimdall comments conflict, stop for a user decision unless repository evidence makes the intended behavior unambiguous.

## 3. Implement, validate, and update the PR

Before editing, record the actionable Heimdall comments and their file/line locations. Then:

1. Apply all unambiguous in-scope fixes.
2. Inspect the complete diff, including unrelated pre-existing changes.
3. Run the narrowest authoritative formatter, linter, and tests for the changed code. Add targeted coverage when appropriate; do not claim a check passed unless it ran successfully.
4. If checks fail, fix the root cause and rerun the relevant check. Stop on failures that cannot be safely fixed.
5. Commit only the review fixes and pipeline lint/test repairs required by Step 5, using repository commit conventions. Do not amend or rewrite existing published commits unless explicitly requested.
6. Push the current branch without force. Confirm the PR head changed and the expected commit is visible before posting dispositions.

If no code change is required, do not create an empty commit or push solely to generate activity. You may reply to comments against the existing PR head after validation.

## 4. Reply and resolve with provider evidence

Reply briefly to **each actionable Heimdall comment**, even when several comments share one fix. Do not reply to comments by other reviewers. Each reply must state the disposition and evidence:

- Fix required: what changed, and the focused validation or commit/PR update.
- Already satisfied: where the existing behavior or test proves it.
- Not applicable / incorrect: the concrete behavior or requirement that makes the suggestion inapplicable.
- Needs user decision: the unresolved choice and why execution stopped.

Use the thread ID with the `addPullRequestReviewThreadReply` mutation in [the GitHub GraphQL recipes](references/github-graphql.md); its payload returns `comment { id url }`, not `thread`. When using the REST pull-request review-comment reply endpoint instead, target the top-level review comment ID because that endpoint does not accept a reply ID. Confirm each mutation succeeds and record the reply URL/ID. Use comment IDs to deduplicate dispositions. Do not post duplicate replies if a prior run already contains a disposition for the same comment; inspect the thread first and continue only for comments lacking a response from the current user.

After a successful reply:

- Resolve only a thread opened by the verified Heimdall account, after all Heimdall comments in that thread have been addressed, no user decision remains, and no other reviewer has commented in it. Confirm `isResolved: true` after the `resolveReviewThread` GraphQL mutation.
- Leave threads opened by other reviewers and mixed-reviewer threads unresolved. The current user's explanatory replies do not change the thread's ownership.
- If a mutation fails or returns an uncertain response, re-fetch the thread to check whether the reply/resolution was accepted. Correct a syntax/schema error against the same host's schema and retry only if the intended change is confirmed absent. For persistent API-contract, permission, authentication, or ambiguous-state failures, stop and report the comment/thread IDs and successful mutations already completed.

Re-fetch all threads after replies and resolution. The post-mutation invariant is: every actionable Heimdall comment has a disposition reply, every Heimdall-only addressed thread is resolved, and threads with other reviewers remain unresolved and unanswered by this workflow.

## 5. Wait for the next run, then for Heimdall

After a push, record the PR head SHA and the push time. The GitHub Azure check may be absent until long after Azure has queued the build; its absence immediately after a push is **pending**, not a blocker. Use the last known PR check URL/build and repository pipeline configuration to identify the Azure DevOps project and pipeline definition. If no prior check exists, discover the definition from repository/PR metadata; stop only if the correct pipeline cannot be identified without guessing. Do not reuse an old run as evidence for the new head.

Prefer `azure-devops_pipelines_build` with `action: "list"`, filtering by the identified definition and `branchName: "refs/pull/<number>/merge"`. Inspect the returned `triggerInfo["pr.sourceSha"]` (and `triggerInfo["pr.number"]` when present) for an exact match to the current **GitHub PR head SHA**. Azure `sourceVersion` on a PR build can be the synthetic merge commit, so it is not an adequate head-SHA comparison. If several runs match, follow the latest queued run; a run for an older head never satisfies the wait. Once found, record its build ID, queue/start timestamps, and URL. Check the GitHub status only when helpful for correlation, not as the sole discovery mechanism.

Use a bounded, low-token wait in **two phases**. Each poll cycle checks both the matching Azure run and the PR's review threads: a running build is not evidence that Heimdall has not posted findings. Record Heimdall comment IDs already assessed or answered; fetch unresolved threads with pagination as in Step 1 and compare only verified Heimdall comment IDs to that set. New Heimdall comments interrupt the wait immediately, including while the build is queued or running. Comments solely from other reviewers do not restart the review cycle. Recheck the PR head before acting on them, then follow Steps 2–4. After a reply-only cycle, resume monitoring the same matching run; after a push, start over with the new head/run.

1. **Appearance:** allow an initial ~2-minute quiet period after the push, then check Azure and review threads about every ~2 minutes for the matching build or new Heimdall comments. At 15 minutes with no run, report a *delay* (not a failure) and keep checking Azure every ~5 minutes up to 60 minutes after the push, while continuing to check threads about every ~2 minutes. If still absent, investigate path filters, disabled PR triggers, API/permission issues, and pipeline health before reporting a missing-run blocker. Do not wait for a build if the actual changed paths are excluded from the PR trigger; explain that no run is expected.
2. **Execution:** once matched, check Azure and threads about every ~2 minutes. A queued build is still pending; queue-to-start delays of tens of minutes are possible. Determine Heimdall **stage** completion from the matching run's job-level evidence when available (for example, the Azure DevOps build timeline via existing authenticated access). An individual Heimdall job can finish while another Heimdall job or the stage remains pending, and comments can arrive later; do not treat that first job's success as the end of review. Use `azure-devops_pipelines_run` or `azure-devops_pipelines_build_log` only when needed to distinguish Heimdall from other stages. Once the Heimdall stage is terminal, recheck threads, then make one more thread scan after ~2 minutes to catch publication lag before declaring a clean run; new Heimdall comments at either scan enter the review cycle. If stage-level evidence is unavailable, wait for the **matching build's** terminal result as a conservative upper bound and say which signal was observed. At 2 hours after queueing, give a delayed-status update and investigate; at 3 hours, report the still-pending run and stop monitoring rather than claim completion.

Keep the Azure MCP read and the GitHub thread scan in the **same short cycle**, not in a long Azure-only batch. Use `gh api --hostname <host> graphql` for thread scans and the Azure DevOps MCP for pipeline reads; use a fallback Azure API only when the MCP cannot expose the needed job-level state. Between cycles a bounded `sleep` in `bash` spends no model tokens. If batching Azure reads in `mcpScript`, return within ~2 minutes so the next GitHub scan can interrupt promptly; a 10–15-minute build-only batch hides new reviews. Emit only changed state, run IDs, elapsed time, and the relevant stage/job result, not full build HTML or unchanged responses. Check the PR/head SHA at each cycle and before acting on a terminal result; stop if the branch advances unexpectedly.

### Pipeline failure triage

Classify failures as they appear, using the matching run's timeline, job/step logs, and pipeline `dependsOn`, `condition`, and `continueOnError` settings. The aggregate build result is not the Heimdall result: a failed build or `succeededWithIssues` job can still allow Heimdall to run. Check failed steps inside warning/non-blocking jobs as well as jobs marked failed.

- **Lint, unit test, or Playwright test failures:** investigate and fix the root cause even when the check is optional, uses `continueOnError`, or Heimdall still runs. Read the failing logs and available test reports; reproduce with the repository's authoritative commands when possible. Use Step 3 to make the smallest safe repair, validate, commit, and push, then monitor the new head's run. Do not suppress the check, weaken assertions, or dismiss an actual failure as a warning or flake. If a failure cannot be safely repaired (for example, unavailable test infrastructure or an ambiguous out-of-scope change), report the evidence and exact remaining blocker after investigation.
- **Unrelated warnings or failures:** record them separately and continue monitoring Heimdall and addressing its comments when they do not prevent its review job(s) from running. For example, a FOSSA failure is non-blocking for this workflow when Heimdall remains eligible to run or has run; the scanner's name alone does not establish whether it is blocking. Repairing unrelated checks is outside this workflow.
- **Failures that prevent Heimdall from running:** report a pipeline blocker only with evidence that the failure causes the required Heimdall review job(s) to be skipped or unable to run, such as a failed dependency and an unsatisfied job condition. A queued/pending job or an aggregate red build alone is not that evidence. If the dependency failure is a lint/test failure, take the repair path above first.

A failed/canceled Heimdall review job itself, or a skipped review whose cause remains unknown after investigation, leaves review completion unverified; report that specific problem rather than blaming an unrelated failed check. If job-level evidence is missing, retrieve the timeline/logs or pipeline conditions before classifying an aggregate failure. Do not infer successful review or a blocking dependency from the build summary alone.

Interpret terminal states carefully:

- A completed successful Heimdall stage (or matching build when stage evidence is unavailable), followed by the second clean thread scan, permits the final done-condition check. A failed aggregate build can also permit it when job-level evidence confirms the required Heimdall review job(s) completed successfully and triage shows only unrelated non-blocking failures.
- A completed run with review findings requires another review cycle after the findings are replied to and any fixes are pushed. If all findings are answered without code changes, its completed result can satisfy the wait; an empty commit is not needed.
- A failed run that clearly produced Heimdall comments is handled as a review cycle, while applying the failure triage above. Comments prove publication, not successful completion of every required Heimdall review job. If fixes are pushed, wait for a **new** run matching the new head before finishing.

Before finishing, inspect the matching run's lint, unit test, and Playwright results, including failing steps under warning/non-blocking jobs. If these checks are still pending after Heimdall finishes, keep monitoring them within the execution wait bounds; do not wait for unrelated jobs merely to obtain a green aggregate build. Recheck results after every pushed repair. A check skipped by intentional path/trigger configuration is not a test failure; a check skipped because of an earlier failure is not proof validation passed.

## 6. Repeat until the done condition is true

When new Heimdall comments appear during the wait, repeat Steps 2–5 immediately; do not wait for unrelated pipeline stages to finish before addressing them. After the Heimdall stage reaches a terminal state (or the build when stage evidence is unavailable), re-fetch the PR threads and status for the current head and honor the final publication-lag scan from Step 5. Repeat Steps 2–5 whenever the review produced new unanswered Heimdall comments or a pushed fix triggered a new Heimdall run.

Finish only when all of these are true:

- the active branch still points to the intended PR;
- the latest relevant Heimdall review for the current PR head completed successfully using the evidence in Step 5, and the post-terminal thread scans (including publication lag) are clean;
- the current head's pipeline lint, unit test, and Playwright checks are accounted for, with no pending checks or unresolved failures (unless the user explicitly accepted a specific remaining failure); unrelated non-blocking failures do not prevent completion;
- there are no remaining unaddressed Heimdall comments from the latest review; and
- every actionable Heimdall comment has a brief disposition reply; Heimdall-only addressed threads are resolved, while threads with other reviewers remain unresolved.

Report the PR URL, commits pushed (if any), each Heimdall comment's disposition and reply, which Heimdall threads were resolved, the final Heimdall job/stage result separately from the aggregate pipeline result, validation commands/results and lint/test repairs, and any unrelated non-blocking failures left unchanged. Do not report dispositions for other reviewers' comments. Never report completion while any done-condition item is unverified.
