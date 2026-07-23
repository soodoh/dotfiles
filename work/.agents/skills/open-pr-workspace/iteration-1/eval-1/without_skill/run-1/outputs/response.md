Dry-run PR preparation only; no repository or remote changes were made.

**Preparation Plan**
- **Jira verification:** Extract `OB-731` from `[OB-731] normalize cache keys`, then open Jira and confirm the issue exists, is accessible, is not closed/cancelled, and that its summary/scope matches the cache-key diff. I would include the canonical Jira issue URL in the PR body. Because this is a dry run and no Jira evidence was provided, Jira verification remains pending rather than being represented as complete.
- **Branch choice:** Use `develop` as the PR base because repository evidence identifies it as GitHub's default branch. Use the current local `feat/cache-key` as the head branch. Do not create or switch branches. Since the branch has never been pushed and has no upstream, a real run would publish it with `git push --set-upstream origin feat/cache-key` only after validation; this dry run does not push.
- **Rebase:** Before publication in a real run, fetch the remote and inspect `develop...HEAD`, then rebase `feat/cache-key` onto the latest `origin/develop` so the PR is based on the current default branch. Resolve any conflicts locally, rerun checks, and confirm the resulting diff still contains only the intended cache-key work. Since the branch is unpublished, rebasing would not disrupt collaborators or require a force-push. No fetch or rebase is performed in this dry run.
- **Checks:** Review the final `origin/develop...HEAD` diff and changed-file list, then run the repository-prescribed formatting, lint, typecheck, unit/integration tests, and any cache-specific tests discovered from project scripts/CI configuration. Confirm the worktree is clean and no files are staged before opening the PR. No commands are executed here, so check results must not be claimed as passing; the PR's Testing section should be updated with exact commands and outcomes after they run.
- **Title:** `[OB-731] Normalize cache keys`
- **Reviewer selection:** Request `@acme/cache-team` because `.github/CODEOWNERS` owns the changed `src/cache/**` paths. GitHub may auto-request the team, but verify it appears in the reviewer list and request it manually if needed. Add no speculative reviewers unsupported by repository evidence.

**Proposed PR Body**

```markdown
## Summary
- Normalize cache keys in the cache implementation.
- Keep the change scoped to the `src/cache/**` feature diff.

## Jira
- [OB-731](<canonical Jira URL>)
- Verification pending: confirm the issue exists, is active, and matches this change before opening the PR.

## Testing
- Not run (dry-run preparation only).
- Before opening: run the repository-prescribed format, lint, typecheck, test, and cache-specific validation commands, then record their exact results here.

## Risk
- Cache-key normalization can change cache hit/miss behavior and may invalidate or bypass existing entries.
- Review normalization edge cases and compatibility with previously generated keys; confirm tests cover equivalent inputs, collisions, and existing-key behavior.
```

**Dry-Run Result**
- Intended PR: `feat/cache-key` into `develop`.
- Publication, upstream creation, rebase, Jira access, checks, PR creation, and reviewer requests were deliberately not performed.
- No repository files, index state, branches, commits, or remotes were changed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Prepared only the requested dry-run PR plan and proposed metadata; no repository or remote operation was performed and scope was not widened."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Used the supplied evidence: base branch develop, head branch feat/cache-key, Jira key OB-731, CODEOWNERS reviewer @acme/cache-team, and the required PR template sections.",
    "No checks were run and no Jira or GitHub action was performed because the task is dry-run only."
  ],
  "residualRisks": [
    "Jira issue status, summary, and canonical URL remain unverified.",
    "The branch has not been rebased onto the latest origin/develop.",
    "Repository checks have not been run.",
    "The final diff and worktree/index state were not independently inspected in this dry run."
  ],
  "noStagedFiles": true,
  "diffSummary": "No repository diff was created; only a dry-run PR plan, title, template body, and reviewer choice were prepared.",
  "reviewFindings": [
    "no blockers identified from the supplied evidence; Jira verification, rebase, and checks remain required before opening the PR"
  ],
  "manualNotes": "noStagedFiles is based on the task's stated clean-branch condition and the fact that no repository mutation was made; no git command was run to independently verify index state."
}
```
