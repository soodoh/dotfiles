This is a dry-run plan only. I would not create a Jira issue, stage or commit files, create or switch branches, fetch or rebase, run formatters, push, request reviewers, or create/update a PR.

**Repository And Jira Discovery**

1. I would inspect the repository read-only with `git status --short --branch`, `git remote -v`, and `git log --oneline --decorate -n 20`; confirm `origin` is the intended GitHub repository; check `gh auth status`; and query `gh repo view --json nameWithOwner,defaultBranchRef,pullRequestTemplates`. The GitHub-discovered base is `trunk`, so I would use `trunk` rather than assume `main` or another conventional branch.
2. I would read root and changed-path guidance (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING*`, relevant `README*`, package scripts, CI workflows, PR templates, and `CODEOWNERS`) and inspect unstaged/untracked changes with `git diff`, `git diff --stat`, and targeted file reads. I would also inspect `git log --format='%h%n%B' origin/trunk..HEAD` after fetching in a real run so the prospective PR range is accurate.
3. I would search for a Jira key in priority order: prompt/conversation, current branch (`feature/session-cleanup`), then subjects and bodies in `origin/trunk..HEAD`. The scenario establishes that none exists, so I would invoke the Jira workflow rather than invent or silently omit a key.
4. Jira fallback: after using live `twg help` to discover the installed command contracts, I would verify project `OB`, infer the issue type from the diff (likely `Task` for cleanup, but only if the changes confirm that), discover the OB Scrum board and require exactly one active sprint, and inspect create metadata. I would propose one issue with an action-oriented summary derived from the actual session-cleanup diff and a description containing supported `Context`, `Scope`, `Acceptance criteria`, and `Validation` sections. It would be assigned to `me` and placed in the verified active sprint. I would not associate an epic unless the request or repository evidence clearly supplied one. In a non-dry run I would create it using the exact live-help syntax, then read it back to verify project, type, summary, description, assignee, and sprint. In this dry run I would create nothing; the eventual canonical result is represented below as `<OB-KEY>` and `<JIRA-URL>`.

**Safe Branch And Commit Handling**

1. I would confirm the current branch, upstream, and same-named remote with `git branch --show-current`, `git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'`, and `git ls-remote --exit-code --heads origin "feature/session-cleanup"`. A detached HEAD would stop the workflow.
2. `feature/session-cleanup` is non-default, dirty, and already exists on `origin`. I would not rename, rebase, force-push, or otherwise rewrite that published branch. I would first review all staged, unstaged, and untracked content for scope, generated files, credentials, and secrets. I would ask before including anything suspicious or unrelated.
3. Once the fallback Jira issue produced its canonical key, I would stage only reviewed intended paths (not blindly run `git add -A`) and commit the intended changes on `feature/session-cleanup`, allowing the repository hooks to run. The commit would follow this repository's conventional format (`type(scope): message`, using a valid scope) and include `<OB-KEY>` where compatible with that convention. If hooks or checks modified files, I would inspect and deliberately include only valid in-scope results.
4. At that commit, I would create a fresh unpublished child branch named exactly `<OB-KEY>`. Before doing so I would check both local and remote refs for that name. If it already existed, I would inspect it rather than overwrite it; only after confirming safety would I use a clear variant such as `<OB-KEY>-pr`. This keeps the existing `origin/feature/session-cleanup` untouched.
5. I would fetch with `git fetch origin` (no pruning), review `git log --oneline origin/trunk..HEAD`, and stop if the range contains unrelated history. I would rebase only the fresh unpublished child branch with `git rebase origin/trunk`; I would never rebase `trunk` or the existing published feature branch and would never force-push.
6. For a conflict, I would inspect the base version, branch version, surrounding code, relevant tests, and rename/delete history. I would resolve and stage a path only when intent is clear and both compatible changes are preserved. I would not select blanket `ours`/`theirs` or leave markers. If intent were ambiguous, I would run `git rebase --abort` to restore the child branch's pre-rebase state and ask for direction.
7. After rebase I would inspect `git diff --check`, `git diff origin/trunk...HEAD`, and the commit list for scope, secrets, accidental history, and conflict artifacts. Because the child is unpublished, rebasing it does not rewrite remote work.

**Validation**

I would infer the narrowest authoritative gates from repository guidance, CI, hooks, package scripts, and the changed paths, then run all applicable formatting/lint, type-check, test, and build commands. I would not invent commands, bypass hooks, add suppression comments, or claim success for an unrun check. Safe formatter fixes would be inspected and committed conventionally. A substantive in-scope failure would be fixed at its cause and rerun; an authentication, dependency, or environment failure that prevents an authoritative check would stop the workflow before push unless explicitly accepted. If fixes added a commit and `trunk` had moved, I would fetch and rebase the unpublished child again.

Dry-run validation record for the proposed PR body:

- `<repository-defined formatting/lint command> — Not run (dry run)`
- `<repository-defined type-check command> — Not run (dry run)`
- `<repository-defined test command> — Not run (dry run)`
- `<repository-defined build command> — Not run (dry run)`

Only commands actually applicable to the changed paths would remain in the final body. No checkbox would be marked passed in this dry run.

**PR Metadata And Reviewers**

- Base: `trunk`.
- Head: `<OB-KEY>` (or the inspected, non-colliding `<OB-KEY>-pr` fallback).
- Title: `[<OB-KEY>] clean up session handling` only if that wording is supported by the final diff; otherwise I would use a concise imperative description derived from the verified diff.
- Body: I would preserve and complete the repository PR template exactly. If none exists, I would use `Summary`, `Jira`, `Validation`, and `Risk` sections. It would link `<JIRA-URL>`, explain what changed and why, state user-visible/operational impact, list exact validation commands and truthful outcomes, and cover risks, rollout, screenshots, or follow-ups when applicable. Every unexecuted check would say `Not run (dry run)`, and inapplicable required sections would say `N/A` with a reason.
- Reviewers: I would use the smallest evidence-backed set, in order from explicit repository/template rules, matching `CODEOWNERS`, then repeated reviewers on recent comparable merged PRs touching the same area. I would exclude the author and unavailable/speculative accounts. If GitHub automatically requests CODEOWNERS and no manual request is required, I would rely on that; if no evidence supports a reviewer, I would omit `--reviewer` and report that fact.

**Duplicate Check And Final Mutation Gate**

Immediately before any real mutation, I would require: selected head is not `trunk`; the working tree is clean; Jira key, base, and head are correct; validations passed; the final diff is in scope and secret-free; and no existing PR is associated with the selected head. The duplicate check would be:

```bash
gh pr list --head "<head>" --state all --json number,state,url,title
```

If any open, closed, or merged PR exists, I would return its URL and not create a duplicate; I would update it only if explicitly requested. Otherwise, in a non-dry run, I would push without force using `git push --set-upstream origin "<head>"`, write the completed body to a temporary file, and call `gh pr create --base trunk --head "<head>" --title "[<OB-KEY>] <verified description>" --body-file "<body-file>"`, adding `--reviewer` only when justified. I would remove the temporary file and verify the result with `gh pr view --json url,number,title,body,baseRefName,headRefName,isDraft,reviewRequests,statusCheckRollup`. I would confirm the Jira link/key, title, body, branches, reviewer requests, and checks, correcting only deterministic metadata mistakes once.

No repository, Git, GitHub, or Jira state was changed. The only file written is this evaluation transcript at the runtime-mandated output path.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Provided a dry-run-only PR plan covering Jira fallback, safe handling of the dirty published feature branch, conflict behavior, validation, metadata, reviewers, and duplicate detection without mutating repository, GitHub, or Jira state."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/open-pr-workspace/iteration-2/eval-2/with_skill/run-1/transcript.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "No repository validation commands were executed because this was an explicit dry run.",
    "No Jira, Git branch/commit/rebase/push, reviewer, or PR mutation was performed."
  ],
  "residualRisks": [
    "The exact Jira summary/type, validation commands, PR description, and reviewers remain dependent on inspecting the actual diff and repository evidence during a real run.",
    "Remote branch divergence, unrelated commit history, name collisions, conflicts, authentication, and existing PR state must be checked live before mutation."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the required dry-run evaluation transcript; no project files or repository state were changed.",
  "reviewFindings": [
    "no blockers in the dry-run plan; live checks remain required before execution"
  ],
  "manualNotes": "The runtime output-path override required the response at transcript.md; the conflicting response.md destination was intentionally ignored."
}
```
