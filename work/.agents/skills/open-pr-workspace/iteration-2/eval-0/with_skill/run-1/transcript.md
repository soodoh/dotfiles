Dry run complete. I would prepare one PR for the existing local commit and would not create or update Jira, alter Git history, create a branch, fetch/rebase, push, request reviewers, or create a GitHub PR.

**Repository Context**
- Repository: `soodoh/dotfiles`; simulated base/default branch: `main`.
- Authoritative starting state: `main` is one commit ahead of `origin/main`, with commit `3b2b471 feat(agents): custom jira ticket skill`, and the working tree is clean.
- Prospective PR scope: `.gitignore`, `unix-configs/.agents/skills/jira/SKILL.md`, and `unix-configs/.agents/skills/jira/evals/evals.json` (215 additions across three files).
- The change adds a reusable Jira-ticket skill, its evaluation cases, and a generated skill-workspace ignore rule. I would stop if the final `origin/main...HEAD` review exposed any other files or commits.
- Jira candidate: prompt-supplied `OB-2468`. Per the scenario, verification has already established that it is active and relevant, so no live Jira lookup or Jira mutation is appropriate.

**Exact Plan**
1. Reconfirm immediately before acting that the repository is `soodoh/dotfiles`, GitHub reports `main` as the real default branch, `main` is still clean and exactly one intended commit ahead, and `OB-2468` remains the selected verified ticket.
2. Check whether local or remote branch `OB-2468` already exists. Because the work starts on the default branch, create `OB-2468` at the existing commit only if that name is unused; never overwrite an existing branch.
3. Fetch `origin` without pruning, then rebase the new unpublished `OB-2468` branch onto `origin/main`. Stop and ask rather than guessing if conflicts occur.
4. Review `git log --oneline origin/main..HEAD`, `git diff --check origin/main...HEAD`, `git diff --stat origin/main...HEAD`, and the full diff for scope, generated material, and secrets. The expected range is only `3b2b471` and the three files listed above.
5. Run the repository-aware checks listed below. Since this is a dry run, none is represented as passed. Do not add a validation-only commit unless a formatter or substantive fix actually changes an intended file.
6. Confirm the working tree remains clean, the head is not `main`, all checks pass, and no PR already exists for head `OB-2468`.
7. Push without force using `git push --set-upstream origin OB-2468`, create the PR against `main` with the proposed metadata, then read it back to verify title, body, base/head, reviewer state, and CI.

The corresponding execution sequence would be:

```bash
git branch --list OB-2468
git ls-remote --exit-code --heads origin OB-2468
git switch -c OB-2468
git fetch origin
git rebase origin/main
git log --oneline origin/main..HEAD
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
bunx commitlint --from origin/main --to HEAD
python3 -m json.tool unix-configs/.agents/skills/jira/evals/evals.json >/dev/null
stow -n -vRt "$HOME" unix-configs
git status --short --branch
gh pr list --head OB-2468 --state all --json number,state,url,title
git push --set-upstream origin OB-2468
gh pr create --base main --head OB-2468 --title "[OB-2468] add custom Jira ticket skill" --body-file '<temporary-body-file>'
gh pr view --json url,number,title,body,baseRefName,headRefName,isDraft,reviewRequests,statusCheckRollup
```

`git ls-remote --exit-code` returning no matching branch is the desired precondition, not a failure of the plan. The temporary body file would be removed after PR creation. No command in this sequence was executed as a mutation in this dry run.

**Proposed PR**
- Branch: `OB-2468`
- Base: `main`
- Title: `[OB-2468] add custom Jira ticket skill`
- Commit: retain the existing repository-compliant conventional commit `feat(agents): custom jira ticket skill`; do not rewrite it merely to add the Jira key.
- Template: no checked-in `.github` PR template was found, so use the skill's concise fallback structure.

Proposed body shape:

```markdown
## Summary
- Add a reusable Jira skill for creating well-formed OB work items through the TWG CLI.
- Document safe issue-type inference, active-sprint discovery, optional epic resolution, Markdown formatting, and post-create verification.
- Add evaluation cases covering repository-derived drafts, bugs with epic lookup, and telemetry work without invented requirements.
- Ignore generated skill evaluation workspaces.

## Jira
- [OB-2468](<verified Jira URL for OB-2468>)
- Context: add repository-managed guidance and evaluations for safe, consistently formatted Jira ticket creation.

## Validation
- `git diff --check origin/main...HEAD` — Not run (dry run)
- `bunx commitlint --from origin/main --to HEAD` — Not run (dry run)
- `python3 -m json.tool unix-configs/.agents/skills/jira/evals/evals.json >/dev/null` — Not run (dry run)
- `stow -n -vRt "$HOME" unix-configs` — Not run (dry run)

## Risk
Low. The change is configuration/documentation plus evaluation data; the main residual risk is that TWG CLI contracts or Jira metadata differ from the documented discovery flow. The skill explicitly requires live help and metadata discovery before mutation.
```

The placeholder in the Jira Markdown link must be replaced with the canonical URL already established by Jira verification before creation; I would not invent a Jira host from repository evidence.

**Checks And Reviewer**
- Commit convention: `feat(agents): ...` uses the allowed `agents` scope. The authoritative check is `bunx commitlint --from origin/main --to HEAD`.
- Content integrity: `git diff --check` covers whitespace errors, and `python3 -m json.tool` validates the added evaluation JSON.
- Dotfile integration: `stow -n -vRt "$HOME" unix-configs` previews the GNU Stow result without changing links.
- There are no package test/build scripts in `package.json`; I would not invent a broad test suite. GitHub CI, if configured remotely, remains pending until the PR exists.
- No checked-in `CODEOWNERS`, PR-template reviewer rule, or other repository evidence supports a manual reviewer. I would omit `--reviewer`; if GitHub applies an automatic ownership rule from remote configuration, I would rely on it and report it after reading the PR back.

No repository files, staged files, branches, remotes, Jira issues, or GitHub resources were changed. The only filesystem write is this required evaluation transcript.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Prepared a dry-run-only, repository-scoped PR plan for the existing Jira-skill commit; no git, Jira, or GitHub mutation was performed."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/open-pr-workspace/iteration-2/eval-0/with_skill/run-1/transcript.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short --branch; git branch --show-current; git log -1; git diff-tree; git diff --stat HEAD^..HEAD",
      "result": "passed",
      "summary": "Read-only inspection identified the default-branch commit and its three-file scope; scenario-provided clean-state facts remain authoritative for the simulation."
    }
  ],
  "validationOutput": [
    "Existing commit: 3b2b471 feat(agents): custom jira ticket skill.",
    "Prospective diff: 3 files changed, 215 insertions.",
    "All proposed PR validation commands are explicitly marked Not run (dry run).",
    "No checked-in PR template or CODEOWNERS file was found."
  ],
  "residualRisks": [
    "The branch-name availability, latest origin/main state, GitHub authentication, canonical Jira URL, remote PR metadata, and CI results require verification during a real run.",
    "The TWG CLI/Jira contract can drift; the proposed skill mitigates this by requiring live help and metadata discovery."
  ],
  "noStagedFiles": true,
  "diffSummary": "No repository diff was created; this dry run documents the proposed OB-2468 branch, PR metadata, checks, and evidence-based no-reviewer decision.",
  "reviewFindings": [
    "no blockers in the simulated one-commit PR scope",
    "no evidence supports requesting a manual reviewer"
  ],
  "manualNotes": "Dry-run constraints were honored. The sole written artifact is the required transcript; Jira and GitHub were not queried or mutated."
}
```
