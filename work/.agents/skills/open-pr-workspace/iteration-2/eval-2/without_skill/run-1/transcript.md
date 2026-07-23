This is a dry-run plan only. I would treat the supplied scenario (`feature/session-cleanup`, unstaged changes, an existing `origin/feature/session-cleanup`, and GitHub default branch `trunk`) as authoritative. I would not create a branch, stage or commit files, push, update refs, stash changes, modify the worktree, create a Jira issue, or create/edit a pull request.

**Planned Workflow**
- **Establish state:** Confirm the current branch is `feature/session-cleanup`; inspect `git status --short --branch`, the unstaged diff, configured remotes, and upstream tracking. I would fetch `origin` before comparisons, but only in a real run after permission because fetching updates remote-tracking refs. I would use GitHub's reported default branch, `trunk`, rather than guessing `main` or `master`.
- **Jira discovery and fallback:** Search, in order, the user's prompt, branch name, and commits unique to `origin/trunk` for a Jira key such as `ABC-123`. The scenario says none exists, so I would not invent a key, infer one from unrelated text, or silently create a Jira issue. I would explicitly tell the user that no Jira key was found and ask whether to (1) provide/link an existing issue, (2) create a Jira issue through the project's normal Jira workflow, or (3) continue with an unlinked PR if repository policy permits it. Any Jira creation would be a separate, confirmed mutation; until then, Jira fields and links would be omitted or marked `N/A` according to the repository PR template.
- **Handle the existing branch:** Because both the local branch and `origin/feature/session-cleanup` already exist, I would reuse them—not create, rename, or delete a branch. I would verify the remote branch belongs to the intended repository, set upstream only if it is missing, and compare local/remote tips. Unstaged work is not pushable, so I would first review the diff and ask for approval of the intended commit contents/message; I would never stage unrelated files automatically.
- **Conflict and history safety:** After fetching, I would compare `HEAD` with both `origin/feature/session-cleanup` and `origin/trunk`. If the feature branch is behind or diverged from its remote, I would stop rather than force-push or overwrite remote work, then present safe reconciliation options. If it is behind `trunk`, I would test mergeability using read-only comparisons (for example, a merge-base/merge-tree check). I would not merge, rebase, stash, reset, checkout, or resolve conflicts without explicit approval. Any conflict would be reported with affected paths; the PR would not be pushed/opened as though it were clean. I would use a normal push only when it is fast-forward safe, never `--force` or `--force-with-lease` by default.
- **Validate the change:** Inspect the complete feature diff against `origin/trunk`, including unstaged content before committing and the committed diff afterward. Run the repository-prescribed formatter, linter, type checks, and focused tests, plus broader tests when practical. I would record exact commands and results. I would also check for accidental secrets, generated artifacts, debug code, unrelated files, and an empty diff. Failed checks or unresolved conflicts would be disclosed and would block automatic PR creation unless the user explicitly chose otherwise.
- **Commit and push gate:** Only after the user approves scope and validation would I stage the selected paths, create a conventional commit appropriate to the repository, and push `feature/session-cleanup` to its existing origin branch. I would re-check status and remote divergence immediately before pushing. Since this is a dry run, none of those actions occur.
- **Duplicate-PR check:** Before creation, query GitHub for PRs from `feature/session-cleanup` into `trunk`, including at least open PRs and preferably all states to detect a closed/merged predecessor. A representative read-only check is `gh pr list --repo soodoh/dotfiles --head feature/session-cleanup --base trunk --state all --json number,title,state,url,headRefName,baseRefName`. If an open PR exists, I would return its URL and update nothing unless requested. If only a closed or merged PR exists, I would report it and ask before creating a new PR. I would also re-run the open-PR query immediately before creation to reduce races.
- **PR metadata:** Derive a concise title from the reviewed diff/commits (for example, `refactor(agents): clean up sessions` only if that accurately describes the change), not merely copy the branch name. Build the body from the repository's PR template when present, with sections for purpose, concrete changes, validation commands/results, risk or rollback notes, and the Jira link/status. The base would be `trunk`; the head would be `feature/session-cleanup`. I would use a draft PR if work or validation remained incomplete, apply labels/reviewers only when repository conventions identify them, and avoid unsupported claims such as “all tests pass.” With no approved Jira fallback, the body would explicitly state that no Jira issue is linked rather than fabricate one.
- **Final preflight and creation:** Confirm a non-empty committed diff, clean intended worktree state, successful required checks, no unresolved conflicts, a fast-forward-safe pushed head, correct repository/base/head, and no duplicate open PR. I would show the final title/body and planned `gh pr create --base trunk --head feature/session-cleanup ...` invocation for approval. Only a non-dry-run confirmation would permit execution, followed by reading the created PR back to verify its URL, base/head, title, body, and draft status.

No PR/Jira/branch operation was performed. The only output mutation for this evaluation is this required transcript file. Read-only inspection showed the ambient checkout does not match the supplied hypothetical scenario (`main` was checked out), so I did not use that ambient state to alter the requested plan. No skill was read or used.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Produced only the requested dry-run PR plan, covering Jira fallback, existing-branch handling, conflict safety, validation, PR metadata, and duplicate-PR detection; performed no GitHub, Jira, branch, index, commit, push, or worktree mutation."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/open-pr-workspace/iteration-2/eval-2/without_skill/run-1/transcript.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short --branch && git remote -v",
      "result": "passed",
      "summary": "Read-only inspection completed; ambient checkout was main with one untracked path, rather than the hypothetical feature branch."
    },
    {
      "command": "git diff --cached --quiet",
      "result": "passed",
      "summary": "Confirmed the index had no staged files."
    },
    {
      "command": "git branch --show-current && git log --oneline --decorate -5",
      "result": "passed",
      "summary": "Read-only branch and recent-history inspection completed; no refs were changed."
    }
  ],
  "validationOutput": [
    "Confirmed no staged files before writing the required transcript.",
    "No network commands, GitHub writes, Jira writes, Git ref updates, staging, commits, pushes, stashes, merges, rebases, or resets were performed."
  ],
  "residualRisks": [
    "Because this is a dry run, remote divergence, trunk mergeability, repository-required checks, Jira policy, and duplicate PR state remain unverified.",
    "The supplied scenario differs from the ambient checkout; the plan intentionally follows the supplied scenario."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the required evaluation transcript containing a non-mutating PR-opening plan and acceptance evidence.",
  "reviewFindings": [
    "no blockers in the dry-run plan"
  ],
  "manualNotes": "No skill was read or used. The conflicting response.md destination was ignored in favor of the authoritative transcript.md runtime path."
}
```
