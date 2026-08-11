---
name: open-pr
description: >
  Prepare and open a GitHub pull request for the current repository, including
  Jira-ticket discovery or creation, safe branch preparation, rebasing onto the
  repository's real default branch, repository-specific validation, PR-template
  completion, and evidence-based reviewer selection. Use this skill whenever the
  user asks to open, create, raise, submit, or prepare a PR on GitHub, even when
  they only say "PR my changes", "push this branch", or "get this ready for
  review". Also use it when Jira linkage, branch cleanup, or PR metadata is only
  implied by the request.
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

## 3. Choose the head branch safely

Determine whether the current branch is the base/default branch, whether the
worktree is clean, whether an upstream exists, and whether a same-named remote
branch already exists:

```bash
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git ls-remote --exit-code --heads origin "$(git branch --show-current)"
```

Handle detached HEAD as a blocker that requires a named branch.

### Starting on the default branch

Commit the intended staged, unstaged, and untracked changes if present, following
repository commit conventions and hooks. Never use `git add -A` until the status
and diff have been reviewed for generated files, credentials, unrelated work,
or other unsafe content. Include the Jira key in the commit subject when that is
compatible with repository conventions.

Create a branch named exactly with the canonical Jira key, for example
`OB-1234`. If that local or remote name already exists, inspect it rather than
overwriting it; ask before selecting a different branch name.

### Starting on a non-default branch

Reuse the current branch only when all of these are true:

- the worktree is clean;
- the branch has no configured upstream; and
- no same-named branch exists on `origin`.

Otherwise, first commit all intended local changes on the current branch. Then
create a fresh child branch at that commit so the existing/published branch is
not rewritten. Name it with the Jira key. If that name already exists, use a
clear Jira-prefixed variant such as `OB-1234-pr` only after confirming it will
not overwrite or confuse existing work.

If the current clean unpublished branch lacks the Jira key, it may still be
reused, but mention the mismatch in the final report. Never rename or rewrite a
published branch merely to improve naming.

Review the resulting commit range against the base. If it includes unrelated
commits, stop and ask whether to isolate the intended commits; do not open a PR
with accidental history.

## 4. Fetch and rebase before pushing

Fetch without pruning or deleting refs unless repository guidance requires it:

```bash
git fetch origin
git rebase "origin/<base>"
```

Rebase only the selected unpublished head branch. Never rebase the remote base
branch or force-push an existing remote branch.

For conflicts, inspect the base version, branch version, surrounding code,
relevant tests, and rename/delete history. Resolve only when intent is clear and
the result preserves both compatible changes. Stage each resolved path and
continue the rebase. If intent is ambiguous, abort the rebase to restore the
pre-rebase state and ask the user; never guess, choose all "ours"/"theirs", or
leave conflict markers.

After a successful rebase, review `git diff origin/<base>...HEAD` and the commit
list again for scope and secrets.

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

If fixes create a new commit, fetch and rebase again when the remote base moved
since the prior fetch.

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

Push a new branch without force:

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
