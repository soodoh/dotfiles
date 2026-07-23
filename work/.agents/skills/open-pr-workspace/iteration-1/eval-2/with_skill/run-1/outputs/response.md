This is a dry-run plan only. I would not create a Jira issue, stage or commit files, create or switch branches, fetch or rebase, push, request reviewers, or create/update a PR. I would treat the supplied scenario (`feature/session-cleanup`, unstaged changes, an existing `origin/feature/session-cleanup`, and GitHub-discovered base `trunk`) as authoritative.

**1. Inspect and bound the work**

- Run read-only discovery: `git status --short --branch`, `git remote -v`, `git log --oneline --decorate -n 20`, `gh auth status`, and `gh repo view --json nameWithOwner,defaultBranchRef,pullRequestTemplates`.
- Use `defaultBranchRef.name == trunk`; I would not infer `main` or another conventional branch merely because it exists.
- Read root and changed-path guidance (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING*`, `README*`, package scripts, CI workflows, PR templates, and `CODEOWNERS`). Review the unstaged and untracked content before selecting anything, including `git diff`, `git diff --cached`, and `git ls-files --others --exclude-standard`.
- Stop before including generated output, credentials, secrets, or suspicious/unrelated files. If the intended scope is unclear, ask rather than stage it. Review the prospective `trunk..HEAD` history and stop if it contains unrelated commits that need isolation.

**2. Jira fallback first**

No Jira candidate exists in the prompt, `feature/session-cleanup`, or commit subjects/bodies from the prospective `trunk..HEAD` range. I would therefore follow the installed `jira` skill rather than invent a key. In this dry run I would only draft the ticket; no TWG mutation would run.

Proposed ticket draft:

- Project: `OB` / Onboarding
- Type: likely `Task`, because session cleanup is engineering cleanup; I would verify that type from live OB metadata and adjust only if the reviewed diff demonstrates a bug, story, or enhancement.
- Summary: an action-oriented description derived from the reviewed diff, for example `Clean up session lifecycle handling` only if that accurately describes it.
- Description: `Context`, `Scope`, `Acceptance criteria`, and `Validation`, populated only with behavior evidenced by the request and diff. I would not invent impact, tests, an epic, or acceptance details.
- Placement: assignee `me`; discover the OB Scrum board and require exactly one active sprint; discover create metadata and the actual sprint/custom-field contracts from live `twg help`. No epic would be set without explicit or clearly evidenced epic context.

In a real execution I would use the Jira skill’s live-help workflow, create one issue with Markdown-safe description handling, place it in the verified active sprint, and read it back to verify project, type, description, assignee, and sprint. The key returned by Jira—not a guessed key—becomes `<JIRA-KEY>` and its verified URL becomes `<JIRA-URL>`. I would stop if authentication fails, the issue type is unavailable, or there is not exactly one applicable active sprint.

**3. Preserve the published branch**

I would confirm the branch/upstream/remote facts with:

```bash
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git ls-remote --exit-code --heads origin "$(git branch --show-current)"
```

Because `feature/session-cleanup` is dirty and a same-named remote branch exists, I would not reuse it as the PR head, rename it, rebase it, force-push it, or otherwise rewrite its published history.

After the Jira key is canonical and after reviewing every status/diff entry, I would stage only the intended paths (explicit `git add <paths>`, not an unreviewed `git add -A`) and commit them on the current branch. The commit would follow repository conventions and hooks—here, conventional `type(scope): message` with an allowed scope—and include `<JIRA-KEY>` where compatible. I would never use `--no-verify`.

Then I would create a fresh child branch at that commit named exactly `<JIRA-KEY>`. Before doing so I would inspect local and remote refs with that name. If either exists, I would not overwrite it; after inspection/confirmation, a clear variant such as `<JIRA-KEY>-pr` could be used. This preserves `origin/feature/session-cleanup` while carrying the reviewed local commit into an unpublished PR branch.

**4. Update safely and handle conflicts**

On the new unpublished child branch only, I would run:

```bash
git fetch origin
git rebase origin/trunk
```

The fetch would not prune refs. I would never rebase `trunk`, the published `feature/session-cleanup` branch, or force-push an existing remote branch. For each conflict I would inspect the base version, branch version, surrounding code, tests, and rename/delete history. I would resolve and stage a path only when intent is clear and both compatible changes are preserved. I would never blanket-select `ours`/`theirs` or leave markers. If intent is ambiguous, I would run `git rebase --abort` to restore the pre-rebase state and ask for direction.

After success I would inspect `git log --oneline origin/trunk..HEAD`, `git diff --check`, and `git diff origin/trunk...HEAD`, checking scope and secrets again.

**5. Validate from repository evidence**

I would derive the narrowest authoritative gates from repository instructions, changed packages, hooks, CI, and package scripts rather than inventing a generic test command. The current repository guidance requires conventional commits and hooks; its root `package.json` exposes no general validation scripts, so I would not falsely claim `npm test` or similar passed. For documentation/skill JSON changes, applicable evidence could include JSON parsing plus focused schema/evaluation checks if the repository defines them; for session code, I would run the affected package’s formatter/lint, typecheck, tests, and build only when those commands are evidenced by that package or CI.

I would record each exact command and result. Safe formatter/lint fixes would be reviewed and committed conventionally. I would fix substantive in-scope failures and rerun them, but would not add suppressions, skip hooks, reduce checks, or push with an authoritative check blocked by missing dependencies. If a fix commit is needed and `origin/trunk` moved, I would fetch and rebase the unpublished child again.

**6. PR metadata and reviewers**

The title would use the exact shape:

```text
[<JIRA-KEY>] concise imperative description of the verified change
```

I would use the repository PR template returned by GitHub metadata or checked-in `.github` files, preserving its headings, checkboxes, and comments. If there is no template, the body would be:

```markdown
## Summary
- What changed and why, based on the final diff
- User-visible or operational impact

## Jira
- [<JIRA-KEY>](<JIRA-URL>)

## Validation
- `<exact command>` — passed/failed with truthful outcome

## Risk
- Concrete risks, rollout notes, or `N/A` with a reason
```

I would not claim unrun checks passed. Reviewer selection would come only from explicit guidance/template rules, matching `CODEOWNERS`, or repeated reviewers on recent comparable merged PRs. I would exclude the author and speculative/unavailable accounts, rely on automatic CODEOWNERS requests when appropriate, and omit `--reviewer` if no evidence supports one.

**7. Duplicate and final safety checks**

Immediately before any real push, with the selected child branch substituted, I would require: head is not `trunk`; worktree is clean; Jira key and URL are verified; final commit range is scoped; validation passed; and no secret is present. Then I would perform the duplicate check before pushing or creating anything:

```bash
gh pr list --head "<JIRA-KEY>" --state all --json number,state,url,title
```

If the collision-safe head is `<JIRA-KEY>-pr`, I would query that exact head instead. If any open or closed PR already exists for it, I would return its URL and not create a duplicate; I would update it only if explicitly requested.

Only after all gates pass would the real workflow push without force using `git push --set-upstream origin "<head>"`, write the completed body to a temporary file, and run `gh pr create --base trunk --head "<head>" --title "[<JIRA-KEY>] ..." --body-file "<body-file>"` with an evidence-backed reviewer only when justified. I would not use `--fill`. Finally I would read the PR back with `gh pr view --json url,number,title,body,baseRefName,headRefName,isDraft,reviewRequests,statusCheckRollup` and verify the Jira link, title, `trunk` base, child head, body, reviewers, and available checks.

No repository, GitHub remote, Jira state, branch, index, or working-tree file was modified by this dry-run evaluation. The only written file is this required evaluation transcript outside the repository.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Produced only the requested non-mutating PR plan, covering Jira fallback, preservation of the published dirty branch, conflict safety, evidence-derived validation, metadata, reviewers, and duplicate detection."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/open-pr-workspace/iteration-1/published-dirty-missing-jira/with_skill/transcript.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short --branch; git remote -v; git log --oneline --decorate -n 20",
      "result": "passed",
      "summary": "Read-only repository inspection completed; no repository mutation occurred."
    },
    {
      "command": "git branch --show-current; git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'; git ls-remote --exit-code --heads origin <current-branch>",
      "result": "passed",
      "summary": "Read-only branch, upstream, and remote-ref inspection completed."
    },
    {
      "command": "gh auth status; gh repo view --json nameWithOwner,defaultBranchRef,pullRequestTemplates",
      "result": "failed",
      "summary": "Authentication was visible, but GH_HOST targeted the enterprise host while this repository remote is github.com; no mutation was attempted. The evaluation-supplied default branch trunk remained authoritative."
    },
    {
      "command": "git diff --check; git diff --cached --name-only; git diff --name-only; git ls-files --others --exclude-standard",
      "result": "passed",
      "summary": "Read-only diff/index inspection completed and confirmed no staged paths."
    }
  ],
  "validationOutput": [
    "Dry-run invariants preserved: no Jira/TWG creation, git staging/commit/branch/fetch/rebase/push, reviewer request, or GitHub PR mutation was performed.",
    "No repository validation was claimed as passed; the plan requires deriving and recording authoritative checks before a real push."
  ],
  "residualRisks": [
    "The hypothetical Jira key, final issue text, validation commands, reviewer set, and conflict resolutions cannot be finalized until the intended diff and live Jira/GitHub metadata are reviewed in a real run.",
    "Local GH_HOST configuration must be corrected or unset before querying the github.com repository in a real run."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the required external evaluation transcript; repository content and state were left unchanged.",
  "reviewFindings": [
    "no blockers in the dry-run plan; real execution must stop on ambiguous scope/conflicts, authentication failure, secrets, or authoritative validation failure"
  ],
  "manualNotes": "The requested response.md and in-repository progress file were intentionally not written because the runtime output override makes transcript.md authoritative and the task forbids repository mutation."
}
```
