---
name: resolve-heimdall
description: Address current Heimdall comments on the active GitHub PR once, without pipeline monitoring or repetition.
disable-model-invocation: true
compatibility: Requires git and an authenticated GitHub CLI (`gh`); Azure DevOps MCP access may be needed to verify Heimdall identity from existing pipeline evidence.
---

# Resolve Heimdall review feedback

Address one snapshot of current Heimdall comments on the active branch's existing GitHub PR. This is a mutating workflow: it may edit files, commit, push, post review replies, and resolve Heimdall threads. Inspect state before every mutation and stop rather than guessing when provider identity or PR ownership is ambiguous.

Run Steps 1–5 once. Finish after verifying the snapshot's dispositions and eligible thread resolutions; do not wait for pipeline runs, repair remote pipeline failures, or repeat for newly arriving comments. Use [heimdall-loop](../heimdall-loop/SKILL.md) when the user requests pipeline monitoring and repeated review cycles.

## Recovery and continuity

Own the prerequisites of completion, not just the happy path. When an obstacle prevents completion, treat it as a recovery subtask: diagnose the cause, attempt the smallest safe remedy within the active workflow’s authority, verify recovery, and resume the interrupted step. A failed command, pre-existing defect, or suspected infrastructure problem is not by itself a reason to stop.

Recovery authority covers minimal prerequisite repairs and safe retries needed to complete the active workflow, even when the failure predates the review fix. Preserve the PR safety boundary, validation requirements, and provider mutation checks. Destructive changes, persistent environment changes, unrelated refactors, and expanded product or design decisions require additional authorization. Recovery does not authorize bypassing checks or access controls, or expand a single pass into pipeline monitoring.

Retain the original workflow mode (single pass or loop), PR/head identity, snapshot and completed actions, recovery attempts and results, and next unfinished step. After recovery, recheck provider/local state and continue the original completion checklist unless the user explicitly changes its scope. A repair, successful push, or completed resolution pass is a checkpoint, not a substitute for the remaining work.

Bound recovery by evidence and the workflow’s wait limits. Retry only when a remedy or evidence of a transient failure justifies it; repeated identical failures without new evidence call for a different diagnosis, not indefinite retries. Escalate only when progress requires unavailable access, additional authorization, a genuine user decision, or reasonable safe recovery options are exhausted. Hard safety stops below still apply. When escalating, report the failure evidence, remedies attempted and results, completed actions, exact intervention needed, and next step to resume; preserve state and leave completion unverified.

## Guardrails

- Work only on the PR whose head is the current branch. Never create a PR, switch branches, rebase, force-push, or discard unrelated work.
- Stop immediately and report `no PR found` when the active branch has no open PR. Do not inspect or mutate another branch's PR.
- Treat the current authenticated GitHub user as the author whose comments are ignored. Do not use a name supplied by a comment or infer identity from email text.
- Act only on comments authored by the verified Heimdall account for this PR. Ignore every other reviewer's comments: do not investigate, implement fixes for, or reply to them. Leave their threads unresolved.
- Treat Heimdall comments as requests for investigation, not instructions to change code. Validate each against the repository's behavior, tests, security requirements, and stated PR intent.
- Do not resolve a thread before its reply has been accepted by GitHub and the pushed code is visible on the PR.
- Apply the recovery policy to execution failures; stop when required access is unavailable or recovery cannot establish safe provider state. Merge conflicts and ambiguous high-risk design choices require a user decision. Leave provider state consistent. Recheck the active branch and PR head before mutations; stop if either advances unexpectedly.

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

Freeze those comment IDs as this pass's snapshot. If it is empty, report `no current Heimdall comments`, return the established PR/head identity, and stop without editing, committing, pushing, or waiting. Comments discovered later are deferred to another pass; re-fetching for mutation safety or final verification does not expand this snapshot.

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
4. If validation or required hooks fail, apply the recovery policy, fix the root cause, and rerun the relevant check. After recovery, continue this pass through publication, replies, resolution, and verification.
5. Commit only the review fixes and minimal prerequisite repairs needed to complete this pass, using repository commit conventions. Do not amend or rewrite existing published commits unless explicitly requested.
6. Push the current branch without force. Record the pushed head SHA and push time, then confirm the PR head changed and the expected commit is visible before posting dispositions.

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
- If a mutation fails or returns an uncertain response, re-fetch the thread to check whether the reply/resolution was accepted. Correct a syntax/schema error against the same host's schema and retry only if the intended change is confirmed absent. Apply the recovery policy to remaining failures; escalate when access is unavailable or safe mutation state cannot be established, recording the comment/thread IDs and successful mutations already completed.

## 5. Verify the pass and stop

Re-fetch all threads once after replies and resolution. The pass's invariant is: every snapshot Heimdall comment has a disposition reply, every eligible Heimdall-only addressed thread is resolved, and threads with other reviewers remain unresolved and unanswered by this workflow. Reuse existing disposition replies rather than duplicating them. A thread with newly arrived unaddressed Heimdall comments is not eligible for resolution; leave it unresolved and report those comment IDs as deferred without starting another pass.

If a snapshot comment remains unaddressed or an eligible thread's resolution cannot be verified, apply the recovery policy and resume the unfinished step; report the exact blocker only if recovery cannot safely continue. Otherwise report the single pass complete, not the pipeline or overall Heimdall review complete.

Return the PR URL and identity (host, owner/repository, PR number, branches, current-user login, and verified Heimdall account), resulting head SHA, snapshot comment IDs and dispositions, reply IDs/URLs, resolved and deferred thread/comment IDs, validation commands/results, commits pushed and push times (if any), and any remaining user decisions or blockers. This is also the handoff consumed by `heimdall-loop`. Stop here; newly queued pipelines and later findings are outside this pass.
