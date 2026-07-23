Dry-run PR preparation only; no repository, Jira, GitHub, branch, commit, index, or remote mutations were performed.

**Proposed Preparation**
- **Jira:** Use `OB-731`, inferred from the highest-priority available source containing a credible key: the commit range `develop..HEAD`, including `[OB-731] normalize cache keys`. Before any real branch preparation, verify `OB-731` through Jira/TWG and retain its canonical uppercase key, URL, summary, status, and relationship to the cache-key change. If it is inaccessible, closed, or unrelated, stop and ask for direction rather than creating or using another ticket silently. No Jira issue would be created from the current evidence.
- **Base and head:** Use GitHub's reported default branch, `develop`, as the base. Reuse `feat/cache-key` as the head because the supplied state says it is a clean, non-default, unpublished local branch with no upstream and no same-named remote branch. The branch may be reused even though its name lacks `OB-731`; report that naming mismatch rather than renaming it.
- **History review:** Confirm `develop..HEAD` contains only the intended cache-key commits and inspect `git diff origin/develop...HEAD` for unrelated changes, generated files, and secrets. Stop if the range contains accidental history.
- **Rebase:** In a real run, execute `git fetch origin` followed by `git rebase origin/develop` on `feat/cache-key` only. Do not rebase the base branch, force-push, or rewrite any published branch. If conflicts are ambiguous, abort and ask rather than guessing. Re-review the commit range and diff after the rebase.
- **Checks:** Infer the authoritative narrow checks from repository instructions, CI workflows, changed packages, hooks, and package scripts. Because this is a dry run and no exact repository commands were supplied, record `<repository-defined format/lint command> — Not run (dry run)`, `<repository-defined type-check command> — Not run (dry run)`, `<repository-defined test command> — Not run (dry run)`, and `<repository-defined build command> — Not run (dry run)` only where applicable. Do not claim any check passed.
- **Duplicate/push/create guard:** Before a real mutation, confirm the clean worktree, selected key/base/head, successful checks, absence of a same-named remote branch, and no existing PR via `gh pr list --head "feat/cache-key" --state all --json number,state,url,title`. Then push without force using `git push --set-upstream origin feat/cache-key` and create the PR with explicit base, head, title, and body file. None of these commands were run.

**Proposed PR**

Title:

`[OB-731] normalize cache keys`

Body:

```markdown
## Summary

Normalize cache keys in `src/cache/**` so cache key generation is consistent.

## Jira

[OB-731](<canonical Jira URL for OB-731>)

Verify the canonical Jira summary and that the issue describes this cache-key normalization before opening the PR.

## Testing

- `<repository-defined format/lint command>` — Not run (dry run)
- `<repository-defined type-check command>` — Not run (dry run)
- `<repository-defined test command>` — Not run (dry run)
- `<repository-defined build command>` — Not run (dry run)

Retain only the checks that repository guidance and CI show are applicable, replacing placeholders with exact commands before creating the PR.

## Risk

Cache-key normalization can change cache hit behavior or invalidate existing entries. Review compatibility with existing keys and rely on the applicable cache tests before merge. No rollout or migration requirement has been verified in this dry run.
```

The body preserves all supplied template sections: Summary, Jira, Testing, and Risk. The title uses the required Jira-key format and the concise commit-derived description, subject to confirming it accurately summarizes the final diff.

**Reviewer Selection**
- `.github/CODEOWNERS` maps the changed `src/cache/**` paths to `@acme/cache-team`, so that team is the smallest evidence-based reviewer set.
- Prefer GitHub's automatic CODEOWNERS request and omit `--reviewer` unless repository guidance explicitly requires a manual request. If manual requesting is required, use `--reviewer acme/cache-team` after confirming the team is available and the author is not the only eligible member.
- Do not add speculative individual reviewers.

**Residual Status**
- Jira identity, summary, status, and URL remain to be verified.
- Fetch, remote-branch lookup, duplicate-PR lookup, rebase, diff/history inspection, and repository-defined checks were not run because this is an explicit dry run.
- The supplied branch name does not contain `OB-731`, but safe branch rules support reusing this clean unpublished branch.
- No PR is ready to push until Jira verification and all applicable checks succeed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Prepared only the requested dry-run PR decisions and metadata; no repository, Jira, GitHub, branch, commit, index, or remote changes were made."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/open-pr-workspace/iteration-2/eval-1/with_skill/run-1/transcript.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "No validation commands were executed; all proposed checks are explicitly marked Not run (dry run).",
    "Dry-run proposal covers Jira verification, safe branch reuse, rebase procedure, checks, PR title/body, and CODEOWNERS-based reviewer selection."
  ],
  "residualRisks": [
    "OB-731 has not been verified through Jira/TWG.",
    "Remote branch and duplicate PR state have not been queried.",
    "The branch has not been rebased onto origin/develop and repository-defined checks have not run."
  ],
  "noStagedFiles": true,
  "diffSummary": "No repository diff; only the required dry-run transcript artifact was written outside the repository.",
  "reviewFindings": [
    "no blockers in the supplied scenario; real PR creation remains gated on Jira verification, remote-state checks, rebase, scope review, and successful validation"
  ],
  "manualNotes": "The supplied clean-worktree premise supports no staged files. The only filesystem write is the authoritative transcript required by the evaluation harness."
}
```
