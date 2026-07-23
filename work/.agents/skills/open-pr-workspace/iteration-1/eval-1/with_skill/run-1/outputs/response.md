Dry-run complete. I did not modify the repository, create or update Jira issues, fetch/rebase, run repository checks, commit, push, request reviewers, or create a pull request.

**Proposed PR Preparation**

- **Jira verification:** The branch name `feat/cache-key` contains no issue key, so the candidate comes from the prospective PR commit range `develop..HEAD`: `OB-731` from `[OB-731] normalize cache keys`. Before any branch or remote mutation, I would verify `OB-731` through the authenticated Jira/TWG integration and retain its canonical uppercase key, URL, status, and summary. I would confirm that the issue is accessible, not closed, and describes cache-key normalization. If verification failed or showed an unrelated issue, I would stop and ask for direction rather than silently use it or create another ticket. No Jira issue would be created for this dry run.
- **Base and head:** GitHub metadata identifies `develop` as the default branch, so the PR base is `develop`, not an assumed `main`. I would reuse `feat/cache-key` as the head because the supplied evidence says it is a clean, non-default local branch with no upstream and no published same-named remote branch. Its lack of the Jira key is acceptable for a clean unpublished branch, but I would report the naming mismatch; I would not rename it solely for aesthetics.
- **History review:** Before proceeding, I would inspect `develop..HEAD` and `origin/develop...HEAD` to ensure every commit and changed path belongs to cache-key normalization and that no credentials, generated artifacts, or unrelated history are present. Unexpected scope would be a blocker requiring confirmation.
- **Rebase:** I would run `git fetch origin` without pruning, then `git rebase origin/develop` while still on the unpublished `feat/cache-key` branch. I would not rebase `develop`, force-push, or rewrite a published branch. After a clean rebase, I would recheck the commit list and `git diff origin/develop...HEAD`. If a conflict had unambiguous intent, I would resolve it using the base, branch, surrounding code, tests, and rename/delete history; otherwise I would abort the rebase and ask rather than guess.
- **Checks:** I would derive the authoritative commands from repository guidance, CI workflows, hooks, and the package containing `src/cache/**`, then run the narrowest complete set covering formatting/lint, type checking, cache tests, and any required build. Exact commands cannot be truthfully named from the supplied evidence alone. I would record each command and result and would not claim a pass until it ran successfully. A substantive failure or unavailable authoritative check would block the push unless explicitly accepted.
- **Final safety gate:** Immediately before mutation, I would reconfirm a clean worktree, `feat/cache-key` as head, `develop` as base, verified `OB-731`, successful checks, no same-named remote branch, and no existing PR for `feat/cache-key` via `gh pr list --head "feat/cache-key" --state all --json number,state,url,title`.

**Proposed Metadata**

Title:

```text
[OB-731] normalize cache keys
```

Body, preserving every supplied template heading:

```markdown
## Summary

Normalize cache keys in `src/cache/**` so equivalent cache inputs produce a consistent key. The final wording would be tightened against the verified diff and would state any user-visible or operational impact without inventing details.

## Jira

[OB-731](<canonical Jira URL returned by verification>) — <verified Jira summary>

## Testing

- `<authoritative formatting/lint command>` — passed
- `<authoritative type-check command>` — passed
- `<authoritative cache test command>` — passed
- `<required build command, if applicable>` — passed

The final PR would include only commands actually run and their real outcomes; in this dry run, none were run.

## Risk

Cache-key normalization can change cache hit/miss behavior and may invalidate or bypass previously stored entries. Review the final diff for compatibility, collision risk, and rollout implications. Add a concrete rollback or mitigation note if repository evidence requires one; otherwise mark unsupported template details `N/A` with a reason rather than deleting them.
```

**Reviewer Selection**

The changed `src/cache/**` paths match `.github/CODEOWNERS` entry `@acme/cache-team`, which is the strongest supplied reviewer evidence. I would use only that team and would exclude speculative individuals. If GitHub automatically requests matching CODEOWNERS, I would rely on that automatic request and omit `--reviewer`; if repository settings or guidance require an explicit request, I would pass `--reviewer acme/cache-team`. I would verify the resulting review request after PR creation.

**Commands Proposed, Not Executed**

```bash
# Read-only verification and context
git status --short --branch
git remote -v
git log --oneline --decorate -n 20
gh auth status
gh repo view --json nameWithOwner,defaultBranchRef,pullRequestTemplates
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git ls-remote --exit-code --heads origin "feat/cache-key"
git log --oneline --decorate develop..HEAD
git diff --stat develop...HEAD
# Verify OB-731 with the authenticated Jira/TWG integration here.

# Preparation after Jira verification
git fetch origin
git rebase origin/develop
git log --oneline origin/develop..HEAD
git diff --check origin/develop...HEAD
git diff origin/develop...HEAD
# Run repository-defined format/lint, type-check, cache tests, and build here.

gh pr list --head "feat/cache-key" --state all --json number,state,url,title
git push --set-upstream origin "feat/cache-key"
gh pr create --base "develop" --head "feat/cache-key" \
  --title "[OB-731] normalize cache keys" --body-file "<temporary-body-file>"
# Add --reviewer "acme/cache-team" only if an explicit request is required.
gh pr view --json url,number,title,body,baseRefName,headRefName,isDraft,reviewRequests,statusCheckRollup
```

The fetch, rebase, checks, push, reviewer request, and PR creation are previews only and were not executed. Residual uncertainty remains around the Jira issue's verified summary/URL, the repository-defined check commands and results, the final diff-specific summary, and whether CODEOWNERS review requests are automatic.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Produced only the requested dry-run PR plan from the supplied repository evidence; no repository or remote mutation was performed."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/open-pr-workspace/iteration-1/clean-unpublished-feature/with_skill/transcript.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "No repository commands executed (explicit dry-run)",
      "result": "passed",
      "summary": "Repository, GitHub, and Jira state were left unchanged; proposed commands are clearly identified as unexecuted."
    }
  ],
  "validationOutput": [
    "Read and followed /Users/paul.diloreto/.agents/skills/open-pr/SKILL.md.",
    "Plan uses develop as base, reuses clean unpublished feat/cache-key, derives OB-731 from develop..HEAD, preserves all supplied PR-template sections, and selects @acme/cache-team from CODEOWNERS evidence."
  ],
  "residualRisks": [
    "OB-731 still requires authenticated Jira verification in a real run.",
    "Authoritative repository checks and their outcomes require inspection and execution in a real run.",
    "The final diff and GitHub CODEOWNERS auto-request behavior require verification in a real run."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added the required dry-run transcript artifact only; no repository diff was created.",
  "reviewFindings": [
    "no blockers in the supplied scenario; real execution remains gated on Jira verification, scope review, rebase, and passing checks"
  ],
  "manualNotes": "The alternate response.md and repository progress paths were not written because the runtime output-path override makes transcript.md authoritative and the task prohibits repository mutation."
}
```
