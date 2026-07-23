Dry-run completed without modifying the repository, staging files, rebasing, pushing, or creating a PR. The preparation below uses the repository evidence supplied in the task; no Jira or GitHub write operations were performed.

**Jira Verification**

- Extract Jira key `OB-731` from the commit message `[OB-731] normalize cache keys`.
- Before opening the PR, look up `OB-731` in Jira and confirm that the issue exists, is accessible, belongs to the expected project, and describes the cache-key normalization work.
- Confirm the issue is in a state that permits development/review and use its canonical Jira URL in the PR body.
- Jira was not actually queried in this dry-run, so verification remains a required preflight gate rather than a completed claim. If the issue is missing, inaccessible, or unrelated, stop and resolve that mismatch before creating the PR.

**Branch And Rebase**

- Use `feat/cache-key` as the head branch and `develop` as the base branch. The base comes from the stated GitHub default branch, not from an assumption such as `main`.
- Because `feat/cache-key` has never been pushed and has no upstream, first fetch current remote state, then rebase the local work onto `origin/develop`.
- Planned commands: `git fetch origin`, `git rebase origin/develop`, then rerun checks. Resolve any conflicts locally and repeat validation before proceeding.
- Since this is dry-run only, do not execute the rebase or push. At execution time, publish with `git push -u origin feat/cache-key`; no force push should be needed for a branch that has never existed remotely.

**Checks**

- Confirm the worktree and index are clean before rebasing and again before opening the PR.
- Review `git diff --check origin/develop...HEAD`, the commit list, and the complete diff to ensure the PR contains only the cache-key changes.
- Run the repository's documented formatter/linter, type-check, and test suite, plus the narrow cache tests covering `src/cache/**`. Do not invent command names if the repository does not define them; derive the exact commands from its package/task configuration.
- Record the exact commands and results in the `Testing` section. A failing or unavailable required check blocks PR creation rather than being represented as passing.
- No project checks were executed as part of this dry-run.

**Proposed PR**

Title:

`[OB-731] Normalize cache keys`

Body:

```markdown
## Summary
- Normalize cache keys for consistent cache lookup and storage behavior.
- Keep the change scoped to the cache implementation represented by `develop...feat/cache-key`.

## Jira
- [OB-731](<canonical Jira URL>)

## Testing
- Not run in this dry-run.
- Before opening: run the repository-defined lint, type-check, and test commands, including focused cache tests, and replace this note with exact passing results.

## Risk
- Cache-key changes can affect cache hit rates and compatibility with entries written using the previous key format.
- Review normalization edge cases and confirm expected behavior for existing cache entries.
```

The final Summary should be tightened against the actual diff after the rebase, and the Jira placeholder must be replaced with the verified canonical issue URL.

**Reviewers**

- Request `@acme/cache-team`, because `.github/CODEOWNERS` maps the changed `src/cache/**` paths to that team.
- Let GitHub's CODEOWNERS rules request the team automatically if configured, but verify that the request appears on the draft/PR.
- Add other reviewers only if repository policy, ownership of additional changed paths, or the verified Jira issue requires them; do not choose reviewers from guesswork.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Prepared a dry-run PR plan only; no repository files, branches, commits, remotes, Jira issues, or GitHub PRs were changed."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short --branch && git diff --cached --name-only",
      "result": "passed",
      "summary": "Read-only inspection confirmed there are no staged files in the available workspace."
    },
    {
      "command": "git branch --show-current; git log --oneline develop..HEAD; git diff --name-only develop...HEAD",
      "result": "passed",
      "summary": "Read-only branch, commit, and changed-file inspection; no repository state was modified."
    },
    {
      "command": "git remote -v; git symbolic-ref --quiet refs/remotes/origin/HEAD",
      "result": "passed",
      "summary": "Read-only remote/default-ref inspection; branch selection in this plan follows the task's supplied develop default-branch evidence."
    },
    {
      "command": "rg -n 'src/cache|cache-team' .github/CODEOWNERS; rg --files .github | rg -i 'pull_request_template|pr_template'",
      "result": "passed",
      "summary": "Read-only evidence lookup; the proposed ownership and template structure follow the explicit evidence supplied by the task."
    }
  ],
  "validationOutput": [
    "No staged files were present.",
    "No rebase, push, Jira mutation, GitHub mutation, or project test command was executed.",
    "Jira verification and repository-defined checks remain preflight requirements before opening the PR."
  ],
  "residualRisks": [
    "Jira issue OB-731 was not queried during the dry-run and must be verified before PR creation.",
    "The branch must be rebased onto the latest origin/develop and all repository-defined checks must pass before publication.",
    "Cache-key normalization may reduce cache hits or make existing entries unreachable if backward compatibility is not covered."
  ],
  "noStagedFiles": true,
  "diffSummary": "No repository diff was created; this output contains only a dry-run PR preparation plan.",
  "reviewFindings": [
    "no blockers in the supplied scenario; Jira verification, rebase, and checks are explicit preflight gates"
  ],
  "manualNotes": "Head: feat/cache-key; base: develop; proposed reviewer: @acme/cache-team; proposed title: [OB-731] Normalize cache keys."
}
```
