Dry-run complete. I made no changes to git, Jira, GitHub, or the repository. The repository does not exactly match the supplied clean-working-tree assumption: `main` is one commit ahead of `origin/main`, but `unix-configs/.agents/skills/open-pr/` is currently untracked.

**Findings**
- blocker: `unix-configs/.agents/skills/open-pr/` - `git status --porcelain=v2 --branch` reports this untracked directory, so the working tree is not clean. Before opening the PR, confirm whether it should be committed, ignored, or left explicitly outside the PR; do not silently discard it.
- no blocker in the committed diff: commit `3b2b4712b04557d36d8d439c500706776860278a` is exactly one commit ahead of `origin/main` and changes `.gitignore`, adds `unix-configs/.agents/skills/jira/SKILL.md`, and adds `unix-configs/.agents/skills/jira/evals/evals.json` (215 insertions total).
- no whitespace error: `git diff --check HEAD^ HEAD` passes.
- no JSON syntax error: the committed `unix-configs/.agents/skills/jira/evals/evals.json` parses successfully with `python3 -m json.tool`.
- repository policy fit: the existing commit subject `feat(agents): custom jira ticket skill` follows the repository's Conventional Commit format and allowed `agents` scope in `commitlint.config.ts`.

**Exact PR Plan**
1. Resolve or explicitly acknowledge the untracked `unix-configs/.agents/skills/open-pr/` directory. Re-run `git status --short --branch` and require no unintended staged, modified, or untracked paths before proceeding.
2. Fetch `origin` and verify `main` is still based directly on the latest `origin/main`. The current read-only snapshot is `origin/main` at `c74d2fd` and local `main` at `3b2b471`, with divergence `0 behind / 1 ahead`. If the remote moved, rebase the one local commit onto current `origin/main`, then repeat validation.
3. Create branch `feat/OB-2468-custom-jira-ticket-skill` at the current commit. This preserves the repository's observed `feat/...` branch convention and makes the supplied Jira key discoverable.
4. Push that branch to `origin` with upstream tracking. Do not push the local commit directly to protected/default branch `main`.
5. Open a PR against `soodoh/dotfiles:main` from `feat/OB-2468-custom-jira-ticket-skill` using the proposed title and body below.
6. Confirm the PR contains only commit `3b2b471` and only these paths: `.gitignore`, `unix-configs/.agents/skills/jira/SKILL.md`, and `unix-configs/.agents/skills/jira/evals/evals.json`.
7. Wait for all GitHub checks to pass; because no tracked PR template or `CODEOWNERS` file exists, do not invent additional required sections or reviewers.

**Proposed PR**
- Branch: `feat/OB-2468-custom-jira-ticket-skill`
- Base: `main`
- Title: `feat(agents): add custom Jira ticket skill (OB-2468)`
- Reviewer decision: request no reviewer automatically. This is a personal repository (`soodoh/dotfiles`) with no tracked `CODEOWNERS` or PR template, and the supplied context gives no team/owner mapping. Add a reviewer only if Jira ticket `OB-2468` or repository settings identify one.

Proposed body shape:

```markdown
## Summary
- add a custom Jira ticket skill for agent workflows
- add evaluation cases for the Jira skill
- ignore Python cache files and generated skill evaluation workspaces

## Jira
- OB-2468

## Validation
- [x] `git diff --check HEAD^ HEAD`
- [x] `git show HEAD:unix-configs/.agents/skills/jira/evals/evals.json | python3 -m json.tool >/dev/null`
- [ ] run the Jira skill's documented evaluation/validation command, if one is defined
- [ ] confirm GitHub branch checks pass
```

The Jira item remains plain text because no Jira base URL or verified ticket metadata was supplied; the dry run must not fabricate a link, status, assignee, or acceptance criteria.

**Checks Before Creation**
- Repository state: `git status --short --branch`; require the branch to be ahead only by the intended commit and resolve the current untracked-path blocker.
- Remote freshness: fetch, then verify `git rev-list --left-right --count origin/main...HEAD` is `0 1` immediately before branching/opening.
- Scope: inspect `git diff --stat origin/main...HEAD` and `git diff --name-status origin/main...HEAD`; require exactly the three intended paths.
- Commit policy: run `bunx commitlint --from origin/main --to HEAD`; the subject appears compliant, but the repository hook only runs at commit-message time.
- Content checks: repeat `git diff --check origin/main...HEAD` and JSON parsing. Run any documented skill evaluator only after resolving the clean-tree discrepancy and identifying its command without using this dry run to mutate files.
- GitHub checks: verify all required status checks after PR creation. No package scripts exist in root `package.json`, so there is no repository-wide `test`, `lint`, or `build` script to claim as run.

**Residual Risks**
- `unix-configs/.agents/skills/open-pr/` makes the actual worktree differ from the prompt assumption and could be accidentally included during branch preparation.
- The Jira ticket was supplied only as `OB-2468`; its summary, URL, current status, acceptance criteria, and reviewer ownership were not verified.
- The new skill's behavioral evaluator was not run, and its content was intentionally not read because the task prohibited reading any skill.
- Remote state and GitHub-required checks can change after this snapshot; a fetch and PR-side validation are still necessary.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete review findings identify the blocker at unix-configs/.agents/skills/open-pr/, the three committed paths, validation results, and residual risks."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short --branch && git log -1 --format=... && git diff --stat HEAD^ HEAD && git diff --name-status HEAD^ HEAD",
      "result": "passed",
      "summary": "Confirmed main is ahead by one commit, identified one untracked directory, and enumerated the three committed paths."
    },
    {
      "command": "git remote -v && git branch -vv && git rev-list --left-right --count @{upstream}...HEAD",
      "result": "passed",
      "summary": "Confirmed origin is soodoh/dotfiles and current divergence is 0 behind, 1 ahead."
    },
    {
      "command": "git diff --check HEAD^ HEAD",
      "result": "passed",
      "summary": "No committed whitespace errors found."
    },
    {
      "command": "git show HEAD:unix-configs/.agents/skills/jira/evals/evals.json | python3 -m json.tool >/dev/null",
      "result": "passed",
      "summary": "Committed evaluation JSON is syntactically valid."
    },
    {
      "command": "git show HEAD:commitlint.config.ts; git ls-tree -r --name-only HEAD | rg ...",
      "result": "passed",
      "summary": "Verified allowed commit scopes and found no tracked CODEOWNERS or PR template."
    }
  ],
  "validationOutput": [
    "HEAD 3b2b471 is one commit ahead of origin/main c74d2fd.",
    "Committed diff: 3 files changed, 215 insertions.",
    "git diff --check passed.",
    "Evaluation JSON syntax check passed.",
    "Working tree is not clean: unix-configs/.agents/skills/open-pr/ is untracked."
  ],
  "residualRisks": [
    "Untracked unix-configs/.agents/skills/open-pr/ must be resolved or explicitly excluded before branch/PR creation.",
    "Jira metadata and reviewer ownership were not verified.",
    "Behavioral evaluation and GitHub-required checks remain unverified."
  ],
  "noStagedFiles": true,
  "diffSummary": "Dry-run only; no repository diff was created. The existing local commit modifies .gitignore and adds the Jira skill plus its evaluation JSON.",
  "reviewFindings": [
    "blocker: unix-configs/.agents/skills/open-pr/ - untracked directory contradicts the clean-working-tree assumption and risks accidental inclusion.",
    "no blocker: .gitignore - existing committed change has no whitespace errors.",
    "no blocker: unix-configs/.agents/skills/jira/evals/evals.json - existing committed file parses as valid JSON."
  ],
  "manualNotes": "No skill was read or used. No git, Jira, GitHub, or repository mutation was performed; only this required external transcript artifact was written."
}
```
