Dry run completed without changing Git, Jira, or GitHub. I did not create a branch, rebase, push, request reviewers, or open a PR.

**Findings**
- Blocker: `OB-2468` is verified but unusable for this PR. Jira reports `OB-2468` as the closed/resolved Task “Disable Upload document walkthrough & Update unit tests,” assigned to Papa Asibuo. That work is unrelated to this repository’s custom Jira-skill commit. Per the skill, a closed or unrelated issue must not be silently reused.
- Blocker: the observed worktree does not match the supplied “no working-tree changes” premise. `git status --short --branch` reports `main...origin/main [ahead 1]` plus untracked `unix-configs/.agents/skills/open-pr/`. That directory must be classified as intended or excluded before branch preparation; this dry run does neither.
- The intended committed range appears to be the single commit `3b2b471` (`feat(agents): custom jira ticket skill`) over `origin/main`, changing `.gitignore`, `unix-configs/.agents/skills/jira/SKILL.md`, and `unix-configs/.agents/skills/jira/evals/evals.json` (215 insertions).
- GitHub identifies `soodoh/dotfiles` and confirms the real default branch is `main`. `origin` points to GitHub, `OB-2468` has no same-named remote branch, and no existing PR uses head `OB-2468`.
- No repository PR template or `CODEOWNERS` file exists. Repository guidance in `AGENTS.md` requires conventional commits with scopes including `agents`; the existing commit conforms by inspection.

**Repository-Aware Plan**
1. Stop before mutation and obtain a Jira key whose summary and status match the custom Jira-skill work. Do not use `OB-2468` as currently verified. Also review `unix-configs/.agents/skills/open-pr/` and restore the expected clean-worktree precondition without discarding it.
2. Re-read status and prospective scope, then ensure only commit `3b2b471` and its three intended paths are in `<base>..HEAD`; scan the final diff for unrelated files and credentials.
3. From `main`, create the unpublished branch named exactly with the replacement canonical key: `git switch -c <VALID-OB-KEY>`. If a matching local or remote branch appears, inspect it and stop rather than overwrite it.
4. Update safely with `git fetch origin` followed by `git rebase origin/main` on the new unpublished branch. Stop on ambiguous conflicts; never force-push.
5. Recheck `git log --oneline origin/main..HEAD`, `git diff --check origin/main...HEAD`, the changed paths, and the secret scan. Run the repository-specific checks listed below. If the remote base moved after any fixes, fetch and rebase again.
6. Confirm the worktree is clean, head is not `main`, checks passed, the Jira key is valid, and `gh pr list --head "<VALID-OB-KEY>" --state all` finds no PR. Push with `git push --set-upstream origin "<VALID-OB-KEY>"` (never force).
7. Create the PR against `main` using an explicit body file and no reviewer flag, then read it back with `gh pr view` to verify title, Jira link, base/head, body, reviewer requests, and checks.

**Proposed Metadata**
- Branch: `<VALID-OB-KEY>` after Jira resolution. `OB-2468` is explicitly rejected because it is closed and unrelated.
- Title: `[<VALID-OB-KEY>] add custom Jira ticket skill`.
- If the user explicitly resolves the mismatch and authorizes reuse despite the verified evidence, the mechanical title/branch would be `[OB-2468] add custom Jira ticket skill` / `OB-2468`, but the current skill rules require stopping rather than proceeding with them.
- Base/head: `main` / `<VALID-OB-KEY>`.

**Body Shape**
No repository template exists, so the body would use the skill’s fallback structure:

```markdown
## Summary
- Add a reusable Jira skill for creating well-formed OB work items through TWG.
- Add evaluation cases covering dry runs, bug/epic resolution, and telemetry-ticket drafting.
- Ignore Python caches and generated skill-evaluation workspaces.

## Jira
- [<VALID-OB-KEY>](https://docusign.atlassian.net/browse/<VALID-OB-KEY>)

## Validation
- `git diff --check origin/main...HEAD` — passed.
- `jq empty unix-configs/.agents/skills/jira/evals/evals.json` — passed.
- Targeted credential-pattern scan of `origin/main...HEAD` — passed with no matches.
- `<commitlint command>` — include only after it is run successfully against the final commit.
- `<skill evaluation command>` — include only if the repository/tooling provides and successfully runs an authoritative evaluator.

## Risk
Low runtime risk: this adds agent instructions and evaluation fixtures rather than application code. Residual risk is behavioral prompt quality; exercise the skill evaluations before merge when an authoritative runner is available.
```

**Checks**
- Already run read-only: `git diff --check origin/main...HEAD` passed; `jq empty unix-configs/.agents/skills/jira/evals/evals.json` passed; a targeted secret-pattern scan found no matches.
- Before push: run the repository’s commit hook/commitlint against `3b2b471` using the installed project tooling. The repository has no package scripts and no discovered GitHub workflow defining broader lint, test, typecheck, or build gates.
- Before push, run an authoritative skill evaluator if one is available; do not invent a command or claim the three eval cases passed merely because their JSON parses.
- A Stow apply is not necessary for these documentation/evaluation changes, but a non-mutating Stow simulation may be useful after the unexpected untracked skill directory is resolved.

**Reviewer Decision**
Create the PR without `--reviewer`. There are no explicit reviewer rules, no `CODEOWNERS`, and recent merged PRs are dependency-bot PRs that provide no defensible human reviewer evidence. The repository owner/PR author (`soodoh`) must not be requested as their own reviewer. GitHub automatic ownership review is not expected because no ownership file exists.

**Residual Risks**
- No PR can be considered ready until a relevant, active Jira issue replaces or explicitly resolves the `OB-2468` mismatch.
- The untracked `unix-configs/.agents/skills/open-pr/` means the actual worktree is not clean and could be accidentally included if blindly staged.
- Commitlint and the skill evaluations were not executed in this strict dry run, so their outcomes must not be represented as passing.
- Remote state may change before a real run; branch existence, duplicate PRs, and `origin/main` must be checked again immediately before mutation.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete blocker and risk findings identify `unix-configs/.agents/skills/open-pr/`, `.gitignore`, `unix-configs/.agents/skills/jira/SKILL.md`, and `unix-configs/.agents/skills/jira/evals/evals.json`; validation and reviewer evidence are documented."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short --branch; git remote -v; git log --oneline --decorate -n 20; git branch --show-current; git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'",
      "result": "passed",
      "summary": "Confirmed main is one commit ahead of origin/main and found unexpected untracked unix-configs/.agents/skills/open-pr/."
    },
    {
      "command": "env -u GH_HOST gh repo view --json nameWithOwner,defaultBranchRef,pullRequestTemplates",
      "result": "passed",
      "summary": "Confirmed soodoh/dotfiles, default branch main, and no PR template."
    },
    {
      "command": "twg jira workitem get OB-2468 --fields summary,status,issuetype,resolution,assignee -o json",
      "result": "passed",
      "summary": "Verified OB-2468 is a closed, resolved, unrelated Task titled Disable Upload document walkthrough & Update unit tests."
    },
    {
      "command": "git diff --check origin/main...HEAD",
      "result": "passed",
      "summary": "No whitespace errors in the committed PR range."
    },
    {
      "command": "jq empty unix-configs/.agents/skills/jira/evals/evals.json",
      "result": "passed",
      "summary": "Evaluation fixture is valid JSON."
    },
    {
      "command": "targeted credential-pattern scan of git diff origin/main...HEAD",
      "result": "passed",
      "summary": "No common token, private-key, password, or secret patterns matched."
    },
    {
      "command": "git ls-remote --heads origin OB-2468; env -u GH_HOST gh pr list --head OB-2468 --state all",
      "result": "passed",
      "summary": "No remote OB-2468 branch and no existing PR for that head."
    }
  ],
  "validationOutput": [
    "GitHub default branch: main",
    "Prospective committed diff: 3 files, 215 insertions",
    "git diff --check: passed",
    "evals.json parse: passed",
    "targeted secret scan: no matches",
    "Jira verification: OB-2468 is closed and unrelated"
  ],
  "residualRisks": [
    "OB-2468 is closed and unrelated to the custom Jira skill change.",
    "Unexpected untracked unix-configs/.agents/skills/open-pr/ contradicts the clean-worktree premise.",
    "Commitlint and authoritative skill evaluations remain unrun.",
    "Remote base, branch, and duplicate-PR state must be refreshed before a real PR operation."
  ],
  "noStagedFiles": true,
  "diffSummary": "No files were changed by this dry run; the inspected prospective PR contains one commit changing .gitignore and adding the Jira skill plus its evaluation fixture.",
  "reviewFindings": [
    "blocker: Jira OB-2468 - closed/resolved ticket is unrelated to the custom Jira skill diff and must not be reused silently.",
    "blocker: unix-configs/.agents/skills/open-pr/ - unexpected untracked directory means the observed worktree is not clean.",
    "warning: unix-configs/.agents/skills/jira/evals/evals.json - JSON validity passed, but evaluation behavior was not executed.",
    "no code-level blocker found in the three-file committed diff by the limited dry-run checks."
  ],
  "manualNotes": "Strict dry run: no Git, Jira, or GitHub mutations were performed. The authoritative transcript file is the only evaluation artifact written."
}
```
