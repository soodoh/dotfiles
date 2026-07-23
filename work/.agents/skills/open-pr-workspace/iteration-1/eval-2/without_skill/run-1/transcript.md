This is a dry-run plan only. I would not change the worktree, index, Jira, GitHub, or either local/remote branch during this run.

**1. Establish the exact state**

- Confirm the current branch is `feature/session-cleanup` and inspect `git status --short --branch`, `git diff`, and `git diff --cached` without modifying anything.
- Verify that the only pending work intended for the PR is the supplied unstaged work. I would not stage unrelated files, generated output, secrets, or local configuration.
- Query GitHub for the repository metadata and use the discovered default branch, `trunk`, rather than assuming `main` or `master`.
- Fetch `origin` with pruning before making comparisons, then compare `feature/session-cleanup`, `origin/feature/session-cleanup`, and `origin/trunk` for ahead/behind and divergence. Fetching is part of a real execution, not this dry run.

**2. Jira fallback**

- Search for a Jira key in this order: the user's prompt, the branch name, then commits unique to the branch. Here, all three sources have no key.
- I would not invent a Jira key, fabricate a Jira URL, or silently create a Jira issue.
- The fallback is to ask the user for an existing Jira key or explicit approval to proceed without one (or, if Jira creation is supported and desired, separately request the project and issue details needed to create one). Until that decision is supplied, I would pause before publishing the PR.
- If the user approves proceeding without Jira, I would omit Jira-specific title prefixes and links and explicitly note that no Jira issue is associated. If a key is supplied, I would validate that the issue exists and is accessible before using its key, summary, or URL in PR metadata.

**3. Prepare and validate the work**

- Review the complete diff against `origin/trunk`, not just the unstaged patch, to ensure the PR contains only the intended session-cleanup changes.
- Run the repository's relevant formatter/linter, focused tests, and broader test/build checks required by the project. Any formatter that writes files would require permission because this workflow is currently dry-run only.
- Re-check the diff after validation. In a real execution, I would stage only reviewed paths and create a conventional commit matching this repository's rules, with no `Co-authored-by` trailer. I would never use `git add -A` without first confirming every path is intended.
- Because the current changes are unstaged, they are not yet present on `origin/feature/session-cleanup`; a PR created immediately would omit them. I would therefore not open the PR until the intended changes are committed and safely pushed.

**4. Handle the existing remote branch safely**

- Reuse `feature/session-cleanup`; I would not create a second branch merely because `origin/feature/session-cleanup` already exists.
- If the local branch has no upstream, set it to `origin/feature/session-cleanup` only when pushing. If it already tracks that branch, keep the existing tracking configuration.
- If the remote is unchanged or is an ancestor of the prepared local branch, push normally with `git push -u origin feature/session-cleanup` (or a plain `git push` when tracking is already correct).
- If the remote is ahead or the histories have diverged, stop before pushing. I would inspect the remote-only commits, ask before integrating unexpected work, and use a normal merge or a rebase only with user approval. On conflicts, I would leave the push and PR creation undone, report the conflicted files, and either resolve deliberately or abort the merge/rebase. I would not overwrite conflict markers or discard either side automatically.
- I would never use `--force`; even `--force-with-lease` would require explicit approval after explaining why history rewriting is necessary.

**5. Check for an existing PR**

- After fetching and before creating anything, query GitHub for PRs whose head is `feature/session-cleanup` in this repository and whose base is `trunk`, including open, draft, closed, and merged states. A representative check is `gh pr list --head feature/session-cleanup --base trunk --state all --json number,title,state,isDraft,url,headRefName,baseRefName`.
- If an open or draft PR already exists, do not create a duplicate; report its URL and, with approval, update its metadata after the new commit is pushed.
- If only a closed or merged PR exists, inspect whether the current commits are already represented. I would not blindly reopen or create another PR; I would explain the result and confirm the intended action.

**6. Construct PR metadata**

- Derive a concise, imperative title from the actual final diff/commits. With no Jira key, do not add a fake ticket prefix; an example shape is `fix(agents): clean up session handling`, adjusted to the real scope.
- Set the base explicitly to `trunk` and the head explicitly to `feature/session-cleanup`.
- Build the body from verified facts: a short summary, key implementation points, validation commands and results, manual-testing notes, and any risks or follow-ups. If proceeding under the approved Jira fallback, include `Jira: none` (or equivalent) rather than an invalid link.
- Decide draft versus ready status from validation completeness and user intent. Failed or incomplete required checks should result in no ready-for-review PR; at most I would propose a draft after disclosing the failures.
- Preview the title/body and verify the final GitHub compare range before creation. Only then would I run an explicit command such as `gh pr create --base trunk --head feature/session-cleanup --title "..." --body-file ...`, followed by `gh pr view` to confirm the URL, base/head, title, body, and draft state.

**Dry-run result**

No Git, GitHub, Jira, test, staging, commit, push, or PR-creation command was executed. The current blocker for a real run is the missing Jira association decision; the unstaged work must also be reviewed, validated, committed, and safely synchronized with the existing remote branch before a PR can include it.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Produced only the requested dry-run PR plan, covering Jira fallback, existing-branch handling, conflict safety, validation, metadata, and duplicate detection; no repository, Jira, or remote mutation was performed."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/open-pr-workspace/iteration-1/published-dirty-missing-jira/without_skill/transcript.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "No validation commands were run because the task explicitly required a non-mutating dry run and supplied the relevant repository state as scenario input.",
    "The response artifact was written to the authoritative runtime output path only."
  ],
  "residualRisks": [
    "The supplied repository state was not independently inspected, so a real run must verify branch tracking, divergence, diff contents, available tests, and existing PRs.",
    "A real PR remains blocked until the user supplies a Jira key or explicitly approves proceeding without Jira."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added the required transcript artifact containing a dry-run plan; no repository files were changed.",
  "reviewFindings": [
    "no blockers in the dry-run plan; real execution is intentionally blocked on the Jira fallback decision and repository validation"
  ],
  "manualNotes": "Did not read or use any skill. Did not write the conflicting response.md or progress.md paths because the runtime output override designates transcript.md as authoritative."
}
```
