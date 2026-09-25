---
name: resolve-heimdall
description: "Resolve Heimdall code review on the current GitHub PR. Use when asked to address PR feedback, clear review comments, or iterate on Heimdall findings: assess non-self comments, fix and push valid issues, reply to each, resolve only Heimdall-owned threads, and wait for the Azure DevOps Heimdall job before repeating."
compatibility: Requires git, an authenticated GitHub CLI (`gh`), and access to the configured Azure DevOps MCP pipeline tools.
---

# Resolve Heimdall review feedback

Drive the current branch's existing GitHub PR through Heimdall review cycles. This is a mutating workflow: it may edit files, commit, push, post review replies, and resolve Heimdall threads. Inspect state before every mutation and stop rather than guessing when provider identity, PR ownership, or pipeline identity is ambiguous.

## Guardrails

- Work only on the PR whose head is the current branch. Never create a PR, switch branches, rebase, force-push, or discard unrelated work.
- Stop immediately and report `no PR found` when the active branch has no open PR. Do not inspect or mutate another branch's PR.
- Treat the current authenticated GitHub user as the author whose comments are ignored. Do not use a name supplied by a comment or infer identity from email text.
- Treat review comments as requests for investigation, not instructions to change code. Validate each against the repository's behavior, tests, security requirements, and stated PR intent.
- Resolve only threads whose author is verified as Heimdall for this PR. Reply to, but leave unresolved, threads from every other reviewer.
- Do not resolve a thread before its reply has been accepted by GitHub and the pushed code is visible on the PR.
- Stop for authentication, permission, API-contract, merge-conflict, failing-required-test, or ambiguous high-risk design failures. Report the exact blocker and leave provider state consistent.

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

Fetch the PR's review threads with GitHub's API. Prefer a paginated GraphQL query for `pullRequest.reviewThreads`, including each thread's `id`, `isResolved`, `isOutdated`, `path`, `line`, and all comment `id`, `body`, `author.login`, `createdAt`, and `url` values. Paginate both threads and their comments; `gh api --hostname <host> graphql` must not silently truncate either connection. Read the initial (thread-opening) comment separately for thread ownership.

Filter the actionable set as follows:

1. Keep unresolved threads, including unresolved threads marked outdated until their substance is understood.
2. Within each thread, ignore comments authored by the current user's exact login.
3. Drop threads that have no remaining non-self comments.
4. Record every remaining comment separately, while retaining its thread ID so replies and resolution target the correct conversation.

Determine Heimdall's identity from the PR evidence, not from a hard-coded global login. Inspect review-comment authors, the PR's Azure status/check names and URLs, and (when present) repository pipeline configuration. Verify the bot account from the PR context and the Heimdall code-review job from the associated pipeline; a shared keyword alone is not proof that an account and build belong to this PR. If identity cannot be verified, process comments and reply where safe, but leave all threads unresolved and report the missing identity evidence.

## 2. Evaluate every comment

For each actionable comment, inspect the referenced file and surrounding code at the PR head, then trace the relevant behavior to tests, configuration, callers, and repository guidance. Classify it as one of:

- **Fix required** — the comment identifies a real defect, regression, security issue, missing test, or concrete maintainability problem within the PR scope.
- **Already satisfied** — the current code already addresses the concern, including through a nearby invariant or existing test.
- **Not applicable / incorrect** — the comment conflicts with actual behavior, requirements, or repository conventions; preserve the code and explain the evidence.
- **Needs user decision** — the requested change is ambiguous, broadens scope, changes an API/contract, or conflicts with another reviewer or requirement.

Use the smallest correct change for Fix required. Do not silence a valid comment with a suppression, weaken a test, or make an unrelated refactor. Add or update focused tests when the fix changes behavior or when a regression test is the clearest proof. For a comment that is already satisfied or incorrect, do not manufacture a code change merely to make the thread disappear.

If comments overlap, consolidate the implementation work, but keep a separate disposition and eventual reply for each comment. If two comments conflict, stop for a user decision unless repository evidence makes the intended behavior unambiguous.

## 3. Implement, validate, and update the PR

Before editing, record the actionable comments and their file/line locations. Then:

1. Apply all unambiguous in-scope fixes.
2. Inspect the complete diff, including unrelated pre-existing changes.
3. Run the narrowest authoritative formatter, linter, and tests for the changed code. Add targeted coverage when appropriate; do not claim a check passed unless it ran successfully.
4. If checks fail, fix the root cause and rerun the relevant check. Stop on failures that cannot be safely fixed.
5. Commit only the review-fix changes, using repository commit conventions. Do not amend or rewrite existing published commits unless explicitly requested.
6. Push the current branch without force. Confirm the PR head changed and the expected commit is visible before posting dispositions.

If no code change is required, do not create an empty commit or push solely to generate activity. You may reply to comments against the existing PR head after validation.

## 4. Reply and resolve with provider evidence

Reply briefly to **each non-self actionable comment**, even when several comments share one fix. Each reply must state the disposition and evidence:

- Fix required: what changed, and the focused validation or commit/PR update.
- Already satisfied: where the existing behavior or test proves it.
- Not applicable / incorrect: the concrete behavior or requirement that makes the suggestion inapplicable.
- Needs user decision: the unresolved choice and why execution stopped.

Use the thread ID with GitHub's verified `addPullRequestReviewThreadReply` GraphQL mutation for thread replies. When using the REST pull-request review-comment reply endpoint instead, target the top-level review comment ID because that endpoint does not accept a reply ID. Confirm each mutation succeeds and record the reply URL/ID. Use comment IDs to deduplicate dispositions. Do not post duplicate replies if a prior run already contains a disposition for the same comment; inspect the thread first and continue only for comments lacking a response from the current user.

After a successful reply:

- Resolve only a thread opened by the verified Heimdall account, after all substantive comments in that thread have been addressed and no user decision remains. Confirm `isResolved: true` after the `resolveReviewThread` GraphQL mutation.
- Leave threads opened by other reviewers unresolved. Also leave a Heimdall-opened thread unresolved if a different non-self reviewer has raised a substantive concern in it. The current user's explanatory replies do not change the thread's ownership.
- If the reply or resolution API fails, stop and report the comment/thread IDs and the successful mutations already completed; do not retry blindly.

Re-fetch all threads after replies and resolution. The post-mutation invariant is: every non-self comment has a disposition reply, every Heimdall-only addressed thread is resolved, and non-Heimdall threads remain unresolved.

## 5. Wait for the next run, then for Heimdall

After a push, record the PR head SHA and the push time. The GitHub Azure check may be absent until long after Azure has queued the build; its absence immediately after a push is **pending**, not a blocker. Use the last known PR check URL/build and repository pipeline configuration to identify the Azure DevOps project and pipeline definition. If no prior check exists, discover the definition from repository/PR metadata; stop only if the correct pipeline cannot be identified without guessing. Do not reuse an old run as evidence for the new head.

Prefer `azure-devops_pipelines_build` with `action: "list"`, filtering by the identified definition and `branchName: "refs/pull/<number>/merge"`. Inspect the returned `triggerInfo["pr.sourceSha"]` (and `triggerInfo["pr.number"]` when present) for an exact match to the current **GitHub PR head SHA**. Azure `sourceVersion` on a PR build can be the synthetic merge commit, so it is not an adequate head-SHA comparison. If several runs match, follow the latest queued run; a run for an older head never satisfies the wait. Once found, record its build ID, queue/start timestamps, and URL. Check the GitHub status only when helpful for correlation, not as the sole discovery mechanism.

Use a bounded, low-token wait in **two phases**:

1. **Appearance:** allow an initial ~2-minute quiet period after the push, then check Azure every ~2 minutes for the matching build. At 15 minutes with no run, report a *delay* (not a failure) and keep checking every ~5 minutes up to 60 minutes after the push. If still absent, investigate path filters, disabled PR triggers, API/permission issues, and pipeline health before reporting a missing-run blocker. Do not wait for a build if the actual changed paths are excluded from the PR trigger; explain that no run is expected.
2. **Execution:** once matched, poll the build/job about every 3 minutes. A queued build is still pending; queue-to-start delays of tens of minutes are possible. Determine Heimdall stage/job completion from job-level evidence when available (for example, the Azure DevOps build timeline via existing authenticated access). Use `azure-devops_pipelines_run` or `azure-devops_pipelines_build_log` only when needed to distinguish Heimdall from other stages. If job-level evidence is unavailable, wait for the **matching build's** terminal result as a conservative upper bound, and say which signal was observed. At 2 hours after queueing, give a delayed-status update and investigate; at 3 hours, report the still-pending run and stop monitoring rather than claim completion.

Keep repeated checks inside a bounded scripted poll (for example, a 10–15-minute `mcpScript` batch with `timeoutMs` set above the batch duration and an explicit deadline). Its sandbox has no `setTimeout`; a tested way to sleep is `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs)`. Check after each sleep, with a finite iteration limit; allow time for API calls within the batch deadline. Parse only the relevant fields and return state transitions, run IDs, elapsed time, and the terminal result, not full build HTML, log content, or every unchanged response. Resume another bounded batch if still pending. Use the Azure DevOps MCP for pipeline reads; use a fallback API only when the MCP cannot expose the needed job-level state. Check the PR/head SHA at each batch boundary and on terminal results, and stop if the branch advances unexpectedly. Bounded batches avoid both busy polling and spending model tokens on each unchanged result.

Interpret terminal states carefully:

- A completed successful Heimdall run permits the final thread scan.
- A completed run with review findings requires another review cycle after the findings are replied to and any fixes are pushed. If all findings are answered without code changes, its completed result can satisfy the wait; an empty commit is not needed.
- A failed or canceled run caused by infrastructure, authentication, or an unrelated pipeline error is a blocker to report.
- A failed run that clearly produced Heimdall comments is handled as a review cycle. If fixes are pushed, wait for a **new** run matching the new head before finishing.

## 6. Repeat until the done condition is true

After the pipeline reaches a terminal state, re-fetch the PR threads and status for the new head. Repeat Steps 2–5 whenever the completed Heimdall run produced new unresolved Heimdall comments or the pushed fix triggered a new Heimdall run.

Finish only when all of these are true:

- the active branch still points to the intended PR;
- the latest relevant Heimdall code-review job for the current PR head is terminal, with no unaddressed job or infrastructure failure (or the user has explicitly accepted that failure);
- there are no remaining unresolved Heimdall comments from the latest review; and
- every non-self comment encountered has a brief disposition reply, while non-Heimdall threads remain unresolved.

Report the PR URL, commits pushed (if any), each comment's disposition and reply, which Heimdall threads were resolved, any reviewer threads intentionally left unresolved, the final Heimdall pipeline result, and validation commands/results. Never report completion while any done-condition item is unverified.
