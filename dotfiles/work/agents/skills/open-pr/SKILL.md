---
name: open-pr
description: >
  Prepare and open a GitHub pull request for the current repository, preserving
  an existing non-default branch as the PR head and creating a Jira-named branch
  only from the default branch or detached HEAD. Includes Jira-ticket discovery
  or creation, safe synchronization with the real default branch,
  repository-specific validation, PR-template completion, and evidence-based
  reviewer selection. Use this skill whenever the user asks to open, create,
  raise, submit, or prepare a PR on GitHub, even when they only say "PR my
  changes", "push this branch", or "get this ready for review". Also use it when
  Jira linkage, branch cleanup, or PR metadata is only implied by the request.
compatibility: Requires git and an authenticated GitHub CLI (`gh`). Jira fallback requires the installed `jira` skill and its authenticated TWG CLI.
---

# Open a GitHub Pull Request

Prepare the current work carefully, then create one GitHub PR whose branch,
commits, title, body, checks, and reviewers reflect repository evidence.

## Operating principles

- Treat a direct request to open/create/raise a PR as authorization to commit the
  current intended changes, create or switch branches, rebase, push, and create
  the PR. Ask before including suspicious unrelated changes or making a choice
  that changes the intended scope.
- Inspect before mutating. Preserve user work and never discard changes, rewrite
  a published branch, force-push, bypass hooks, or suppress checks.
- In an explicit dry run, preview, test, or evaluation, do not create Jira
  tickets, commits, branches, pushes, reviewer requests, or PRs. Produce the
  proposed decisions and commands instead. In proposed PR bodies, label every
  unexecuted validation as `Not run (dry run)`; never pair a placeholder command
  with `passed` or a checked checkbox.
- Stop on authentication failures, protected-branch constraints, unclear
  conflicts, failing checks that cannot be fixed safely, or evidence of secrets.
  Report the exact blocker rather than claiming the PR is ready.

## 1. Establish repository context

Inspect the working tree, including untracked files, without changing it:

```bash
git status --short --branch
git remote -v
git log --oneline --decorate -n 20
```

Confirm this is the intended repository and that `origin` points to GitHub.
Check `gh auth status` and identify the repository with `gh repo view --json
nameWithOwner,defaultBranchRef,pullRequestTemplates`.

Use `defaultBranchRef.name` as the base branch. If GitHub metadata is unavailable,
fall back to `refs/remotes/origin/HEAD`; only then consider conventional names
such as `main`, `master`, `develop`, `development`, `dev`, or `trunk`. Do not
assume `main` merely because it exists.

Read the applicable repository guidance before deciding how to commit, validate,
or describe the work. Look for root and changed-path instructions such as
`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING*`, `README*`, package scripts, CI
workflows, PR templates, and `CODEOWNERS`. More-specific path guidance wins.

## 2. Resolve the Jira ticket first

A verified Jira issue is required before branch preparation because its key may
shape the branch, commits, and PR title.

Collect candidate issue keys, using a case-insensitive pattern such as
`[A-Z][A-Z0-9]+-[0-9]+`, from these sources in priority order:

1. A key or Jira URL supplied in the user's prompt or earlier conversation.
2. The current non-default branch name.
3. Commit subjects and bodies in the prospective PR range
   `<base>..HEAD` (not unrelated repository history).

Deduplicate candidates. Verify the best candidate through Jira/TWG and retain its
canonical key, URL, and summary. A prompt-supplied key outranks inferred keys. If
multiple equally plausible verified candidates remain, ask which one belongs to
this PR.

If there is no credible candidate, invoke and follow the installed `jira` skill
to create a ticket from the current request and local-change context. The Jira
skill owns issue type, description, assignment, sprint placement, and mutation
safety. In a dry run or evaluation, describe the Jira ticket that would be
created instead of creating it.

Do not silently use a malformed, inaccessible, closed, or unrelated issue. Ask
for direction if verification shows that the apparent ticket does not describe
the work.

## 3. Select the head branch

Determine whether `HEAD` is attached to a named branch and compare that branch
with the verified base:

```bash
git symbolic-ref --quiet --short HEAD
git rev-parse --short HEAD
```

Use this branch-selection invariant:

- on the default branch, create a Jira-named branch;
- on a named non-default branch, preserve and reuse that branch; and
- on detached HEAD, create a Jira-named branch at the current commit.

Worktree state, upstream configuration, remote publication, and branch naming do
not otherwise change the selected head. If synchronization later becomes unsafe
or ambiguous, stop and ask rather than creating a child branch.

### Creating a branch

When starting from the default branch or detached HEAD, create the branch before
committing local changes so the feature commit is not placed on the local default
branch and detached commits remain anchored:

```bash
git switch -c "<JIRA-KEY>"
```

Use the canonical Jira key exactly, for example `OB-1234`. If that branch already
exists locally or on `origin`, inspect it and ask whether to switch to it or use
a different name. Do not overwrite it or invent a suffixed name automatically.
The branch switch carries compatible staged, unstaged, and untracked work onto
the new branch.

### Reusing a non-default branch

Use the current named non-default branch as the PR head whether or not it has
local changes, a configured upstream, a same-named branch on `origin`, or the
Jira key in its name. A naming mismatch may be reported, but do not rename the
branch or create a Jira-named child solely to improve its name.

Treat upstream and remote state as synchronization concerns, not branch-selection
criteria. Never create a child branch to avoid reconciling an existing branch.

## 4. Synchronize the selected head

Fetch without pruning or deleting refs unless repository guidance requires it:

```bash
git fetch origin
```

If the selected head exists on `origin`, compare its remote and local commits:

```bash
git rev-list --left-right --count "origin/<head>...HEAD"
```

Continue when both sides match or the local branch is only ahead. When the local
branch is only behind, fast-forward it:

```bash
git merge --ff-only "origin/<head>"
```

If local changes prevent that safe update, stop and ask. If the histories have
diverged, stop and ask how to reconcile them. Do not create a replacement branch.

Once the selected head is synchronized with its remote counterpart, review and
commit the intended staged, unstaged, and untracked changes, following repository
commit conventions and hooks. Never use `git add -A` until the status and diff
have been reviewed for generated files, credentials, unrelated work, or other
unsafe content. Include the Jira key in the commit subject when compatible with
repository conventions.

For a new or otherwise unpublished head, rebase onto the merge target only when
it is not already based on the fetched target:

```bash
git merge-base --is-ancestor "origin/<base>" HEAD ||
  git rebase "origin/<base>"
```

This includes a branch created from detached HEAD. Before rebasing detached
commits, inspect `origin/<base>..HEAD`; if the intended replay boundary is unclear
or the range contains unrelated commits, stop and ask.

For a published head, preserve its history. If `origin/<base>` is already an
ancestor of `HEAD`, continue without integration. Otherwise follow repository
guidance: merge `origin/<base>` when merge commits are permitted, or ask before
a rebase that would rewrite the published branch. Never force-push or create a
child branch as a substitute for that decision.

For rebase or merge conflicts, inspect the base version, branch version,
surrounding code, relevant tests, and rename/delete history. Resolve only when
intent is clear and the result preserves both compatible changes. Stage each
resolved path and continue the operation. If intent is ambiguous, abort to the
pre-operation state and ask; never guess, choose all "ours"/"theirs", or leave
conflict markers.

Review `git diff origin/<base>...HEAD` and the commit list for scope and secrets.
If the range includes unrelated commits, stop and ask whether to isolate the
intended work; do not open a PR with accidental history.

## 5. Run lightweight repository quality gates

Infer commands from repository instructions, changed packages, hooks, and package
scripts. Run only the narrowest authoritative checks for applicable formatting,
linting, and unit tests. Prefer targeted package or file-level commands when the
repository provides them.

Do not run Playwright, browser automation, end-to-end, integration, smoke,
acceptance, visual-regression, performance, or other expensive test suites as
part of PR preparation. Do not run broad `test`, `check`, or CI-equivalent
commands when they transitively include those suites; select the repository's
unit-test command or unit-test project instead. Also leave builds and standalone
type-check commands to CI unless repository guidance explicitly classifies them
as part of linting or the user asks for them.

Apply safe formatter or lint fixes, inspect the resulting diff, and commit those
fixes using repository conventions. For substantive failures, fix the root cause
when it is within scope, then rerun only the failing lightweight check. Do not use
suppression comments, `--no-verify`, or skipped hooks to manufacture a pass.

Record each command and outcome for the PR body, including that excluded suites
were intentionally left to CI when useful. If an authoritative lightweight check
cannot run because of an environment or dependency problem, stop before pushing
unless the user explicitly accepts that limitation.

If fixes create a new commit and the remote base moved since the prior fetch,
repeat the applicable synchronization from step 4 without rewriting a published
branch.

## 6. Build the PR title, body, and reviewers

Summarize the final diff and commits rather than copying commit messages blindly.
Use this exact title shape:

```text
[OB-1234] short description of changes
```

Use the canonical Jira key in uppercase. Keep the description concise,
imperative, and specific; avoid repeating the key elsewhere in the title.

Use the repository's GitHub PR template when one exists. Retrieve the template
path/content from repository metadata or the checked-out `.github` template
files, preserve its headings, checkboxes, and HTML comments, and fill every
applicable section from verified evidence. Mark genuinely inapplicable sections
as `N/A` with a short reason rather than deleting required structure. Include:

- a Jira link and concise context;
- what changed and why;
- user-visible or operational impact;
- exact validation commands and outcomes;
- risks, rollout, screenshots, or follow-ups when the template/change requires
  them.

Do not claim tests passed unless they were run successfully. During a dry run,
show exact known commands as `Not run (dry run)` and unknown commands as
`<repository-defined command> — Not run (dry run)`; this keeps the proposed body
truthful when copied later. If no template exists, use concise `Summary`, `Jira`,
`Validation`, and `Risk` sections.

Select reviewers only from repository evidence, in this order:

1. Explicit reviewer rules in repository guidance or the PR template.
2. `CODEOWNERS` entries matching the changed paths.
3. Reviewers repeatedly used on recent, comparable merged PRs touching the same
   area, queried with `gh pr list/view`.

Exclude the PR author, inactive/unavailable accounts, and speculative names.
Prefer the smallest justified reviewer set; use GitHub team handles when the
repository does. If GitHub automatically requests CODEOWNERS and no explicit
manual request is required, rely on that and report it. If no reviewer is
supported by evidence, create the PR without `--reviewer` and say so.

## 7. Push and create the PR

Confirm immediately before mutation that the selected head is not the base, the
working tree is clean, the expected Jira key and base are selected, checks have
passed, and no PR already exists for the head:

```bash
gh pr list --head "<head>" --state all --json number,state,url,title
```

If a PR already exists, return its URL and update it only when the user requested
an update; do not create a duplicate.

Push the selected head without force. If it already tracks `origin`, use:

```bash
git push
```

Otherwise establish its upstream:

```bash
git push --set-upstream origin "<head>"
```

Write the completed body to a temporary file so shell quoting cannot corrupt it,
then create the PR non-interactively:

```bash
gh pr create \
  --base "<base>" \
  --head "<head>" \
  --title "[OB-1234] short description of changes" \
  --body-file "<body-file>" \
  --reviewer "<justified-reviewer>"
```

Omit `--reviewer` when none is justified. Remove the temporary body file after
creation. Do not use `--fill`, because it can bypass the required title and
repository template.

## 8. Verify and report

Read the created PR back with `gh pr view --json
url,number,title,body,baseRefName,headRefName,isDraft,reviewRequests,statusCheckRollup`.
Verify the title key, Jira link, base/head branches, body structure, reviewer
requests, and available checks. Correct deterministic metadata mistakes once; do
not create a replacement PR.

Return the PR number and URL, Jira key and URL, base/head branches, commits made,
validation commands and results, requested/automatic reviewers, and any residual
risk or pending CI. Never report success if push or PR creation failed.
