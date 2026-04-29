# Pi Power User Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Pi power-user baseline to the dotfiles-managed Pi configuration while keeping the setup small, safe, and reproducible.

**Architecture:** Update the existing dotfiles-managed Pi settings file using a merge script so pre-existing user edits are preserved. Add one focused guardrails configuration file under the stowed Pi agent directory. Validate with JSON parsing, package visibility checks, and Pi startup/package diagnostics.

**Tech Stack:** Pi coding agent settings JSON, Node.js for deterministic JSON edits, GNU Stow-managed dotfiles, npm Pi packages.

---

## File Structure

- Modify: `unix-configs/.pi/agent/settings.json`
  - Responsibility: dotfiles-managed global Pi agent settings after stowing to `~/.pi/agent/settings.json`.
  - Changes: pin/declare the curated package baseline, add explicit compaction settings, and add conservative display/resource defaults.
- Create: `unix-configs/.pi/agent/extensions/guardrails.json`
  - Responsibility: dotfiles-managed configuration for `@aliou/pi-guardrails` after stowing to `~/.pi/agent/extensions/guardrails.json`.
  - Changes: enable secret-file protection, destructive-command confirmation, and ask-mode path access outside the current working directory.
- No changes: `docs/superpowers/specs/2026-04-28-pi-power-user-setup-design.md`
  - Responsibility: approved recommendation spec; used as reference only.

## Scope

This plan implements the initial recommended adoption path:

1. Keep and pin `pi-web-access`.
2. Add and pin `@aliou/pi-guardrails`.
3. Add and pin `pi-subagents`.
4. Add guardrails defaults.
5. Add explicit compaction and display defaults.

This plan does not install optional packages such as `pi-ask-me`, `taskplane`, `pi-mcp-adapter`, themes, prompt packs, or footer enhancements.

---

### Task 1: Confirm clean implementation boundary

**Files:**
- Inspect: `unix-configs/.pi/agent/settings.json`
- Inspect: `docs/superpowers/specs/2026-04-28-pi-power-user-setup-design.md`

- [ ] **Step 1: Check current git status**

Run:

```bash
git status --short
```

Expected: `unix-configs/.pi/agent/settings.json` may already be modified from user work. Do not reset or overwrite it. The spec file should already be committed.

- [ ] **Step 2: Verify the approved spec exists**

Run:

```bash
test -f docs/superpowers/specs/2026-04-28-pi-power-user-setup-design.md && echo spec-found
```

Expected output:

```text
spec-found
```

- [ ] **Step 3: Validate current settings JSON before editing**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('unix-configs/.pi/agent/settings.json','utf8')); console.log('settings-json-ok')"
```

Expected output:

```text
settings-json-ok
```

If this fails, stop and ask the user whether to repair the existing settings file before continuing.

- [ ] **Step 4: Commit checkpoint if there are no unrelated tracked changes besides Pi settings**

Run:

```bash
git status --short
```

Expected: review output manually. If files unrelated to this Pi setup are modified, stop and ask the user how to handle them. If only `unix-configs/.pi/agent/settings.json` is modified, continue without committing because the modification is user-owned and will be incorporated by later tasks.

---

### Task 2: Merge curated packages and settings

**Files:**
- Modify: `unix-configs/.pi/agent/settings.json`

- [ ] **Step 1: Apply deterministic JSON merge**

Run this exact command from the repository root:

```bash
node <<'NODE'
const fs = require('fs');
const path = 'unix-configs/.pi/agent/settings.json';
const settings = JSON.parse(fs.readFileSync(path, 'utf8'));

settings.packages = [
  'npm:pi-web-access@0.10.6',
  'npm:@aliou/pi-guardrails@0.11.0',
  'npm:pi-subagents@0.18.1'
];

settings.compaction = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000
};

settings.collapseChangelog = true;
settings.quietStartup = false;
settings.enableSkillCommands = true;

fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
NODE
```

Expected: command exits with status 0 and preserves unrelated existing keys such as `lastChangelogVersion`, `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, and `theme`.

- [ ] **Step 2: Validate settings JSON after merge**

Run:

```bash
node -e "const s=JSON.parse(require('fs').readFileSync('unix-configs/.pi/agent/settings.json','utf8')); console.log(JSON.stringify({packages:s.packages, compaction:s.compaction, collapseChangelog:s.collapseChangelog, quietStartup:s.quietStartup, enableSkillCommands:s.enableSkillCommands}, null, 2))"
```

Expected output:

```json
{
  "packages": [
    "npm:pi-web-access@0.10.6",
    "npm:@aliou/pi-guardrails@0.11.0",
    "npm:pi-subagents@0.18.1"
  ],
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "collapseChangelog": true,
  "quietStartup": false,
  "enableSkillCommands": true
}
```

- [ ] **Step 3: Inspect the diff for accidental changes**

Run:

```bash
git diff -- unix-configs/.pi/agent/settings.json
```

Expected: diff only changes Pi package/settings baseline. It must not remove provider/model/theme settings unless the user had already removed them before this task.

- [ ] **Step 4: Commit settings baseline**

Run:

```bash
git add unix-configs/.pi/agent/settings.json
git commit -m "feat(root): configure pi power user baseline"
```

Expected: commit succeeds and commitlint accepts the conventional commit message.

---

### Task 3: Add guardrails configuration

**Files:**
- Create: `unix-configs/.pi/agent/extensions/guardrails.json`

- [ ] **Step 1: Create the extensions directory**

Run:

```bash
mkdir -p unix-configs/.pi/agent/extensions
```

Expected: command exits with status 0.

- [ ] **Step 2: Write the guardrails config**

Run:

```bash
cat > unix-configs/.pi/agent/extensions/guardrails.json <<'JSON'
{
  "enabled": true,
  "features": {
    "policies": true,
    "permissionGate": true,
    "pathAccess": true
  },
  "pathAccess": {
    "mode": "ask",
    "allowedPaths": []
  },
  "policies": {
    "rules": [
      {
        "id": "secret-files",
        "description": "Block direct access to local secret files while allowing examples and test fixtures.",
        "patterns": [
          { "pattern": ".env" },
          { "pattern": ".env.local" },
          { "pattern": ".env.production" },
          { "pattern": ".env.prod" },
          { "pattern": ".dev.vars" },
          { "pattern": "*.pem" },
          { "pattern": "*.key" }
        ],
        "allowedPatterns": [
          { "pattern": ".env.example" },
          { "pattern": ".env.sample" },
          { "pattern": ".env.test" },
          { "pattern": "*.example.env" },
          { "pattern": "*.sample.env" },
          { "pattern": "*.test.env" },
          { "pattern": "copilot-api/ca-bundle.pem" }
        ],
        "protection": "noAccess",
        "onlyIfExists": true,
        "enabled": true
      }
    ]
  },
  "permissionGate": {
    "patterns": [
      { "pattern": "rm -rf", "description": "recursive force delete" },
      { "pattern": "sudo", "description": "superuser command" },
      { "pattern": "dd if=", "description": "raw disk write/copy command" },
      { "pattern": "mkfs.", "description": "filesystem formatting command" },
      { "pattern": "chmod -R 777", "description": "recursive world-writable permissions" },
      { "pattern": "chown -R", "description": "recursive ownership change" }
    ],
    "customPatterns": [],
    "requireConfirmation": true,
    "allowedPatterns": [],
    "autoDenyPatterns": [],
    "explainCommands": false,
    "explainModel": null,
    "explainTimeout": 5000
  }
}
JSON
```

Expected: file is created. The explicit `copilot-api/ca-bundle.pem` exception preserves access to the repository's checked-in CA bundle.

- [ ] **Step 3: Validate guardrails JSON**

Run:

```bash
node -e "const cfg=JSON.parse(require('fs').readFileSync('unix-configs/.pi/agent/extensions/guardrails.json','utf8')); console.log(JSON.stringify({enabled:cfg.enabled, features:cfg.features, pathAccess:cfg.pathAccess.mode, policyCount:cfg.policies.rules.length}, null, 2))"
```

Expected output:

```json
{
  "enabled": true,
  "features": {
    "policies": true,
    "permissionGate": true,
    "pathAccess": true
  },
  "pathAccess": "ask",
  "policyCount": 1
}
```

- [ ] **Step 4: Inspect the guardrails diff**

Run:

```bash
git diff -- unix-configs/.pi/agent/extensions/guardrails.json
```

Expected: diff shows only the new guardrails JSON file.

- [ ] **Step 5: Commit guardrails config**

Run:

```bash
git add unix-configs/.pi/agent/extensions/guardrails.json
git commit -m "feat(root): add pi guardrails config"
```

Expected: commit succeeds and commitlint accepts the conventional commit message.

---

### Task 4: Validate dotfiles and Pi package resolution

**Files:**
- Inspect: `unix-configs/.pi/agent/settings.json`
- Inspect: `unix-configs/.pi/agent/extensions/guardrails.json`

- [ ] **Step 1: Validate all Pi JSON files**

Run:

```bash
node <<'NODE'
const fs = require('fs');
for (const file of [
  'unix-configs/.pi/agent/settings.json',
  'unix-configs/.pi/agent/extensions/guardrails.json'
]) {
  JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`${file}: ok`);
}
NODE
```

Expected output:

```text
unix-configs/.pi/agent/settings.json: ok
unix-configs/.pi/agent/extensions/guardrails.json: ok
```

- [ ] **Step 2: Verify stow simulation for unix configs**

Run:

```bash
stow -n -vRt "$HOME" unix-configs
```

Expected: command exits with status 0. Review output for conflicts. If conflicts appear under `.pi/agent`, stop and ask the user before forcing stow changes.

- [ ] **Step 3: Apply stow if the user wants the config active immediately**

Run only after user confirmation:

```bash
stow -vRt "$HOME" unix-configs
```

Expected: command exits with status 0 and links `unix-configs/.pi/agent/settings.json` plus `unix-configs/.pi/agent/extensions/guardrails.json` into `$HOME/.pi/agent/`.

- [ ] **Step 4: Check Pi package list after stow or after manually copying settings**

Run:

```bash
pi list
```

Expected: output includes these package sources:

```text
npm:pi-web-access@0.10.6
npm:@aliou/pi-guardrails@0.11.0
npm:pi-subagents@0.18.1
```

If packages are missing and stow was not applied, explain that `pi list` reads the active Pi settings, not only the dotfiles source file.

- [ ] **Step 5: Start Pi enough to trigger package installation/loading**

Run interactively:

```bash
pi
```

Expected: Pi starts without package load errors. The startup header should show loaded packages/extensions/skills. If Pi prompts to install missing packages, allow it only for the three pinned package sources in this plan.

Inside Pi, run:

```text
/reload
```

Expected: reload completes without extension errors.

---

### Task 5: Smoke-test the configured capabilities

**Files:**
- No file changes expected.

- [ ] **Step 1: Smoke-test web access**

Inside Pi, ask:

```text
Use web_search to search for the Pi package catalog and summarize one result in one sentence.
```

Expected: Pi calls the web search tool from `pi-web-access` and returns a sourced or clearly web-derived result.

- [ ] **Step 2: Smoke-test subagents discovery**

Inside Pi, ask:

```text
Show me the available subagents and do not run any of them.
```

Expected: Pi reports available agents such as `scout`, `researcher`, `planner`, `worker`, `reviewer`, or `oracle`, or suggests `/agents` / `/subagents-doctor` if discovery requires an interactive command.

- [ ] **Step 3: Run subagents doctor**

Inside Pi, run:

```text
/subagents-doctor
```

Expected: doctor output does not report missing required dependencies for basic foreground subagent use. If optional integrations are missing, note them but do not install additional packages in this plan.

- [ ] **Step 4: Open guardrails settings**

Inside Pi, run:

```text
/guardrails:settings
```

Expected: guardrails settings UI opens and shows policies, permission gate, and path access enabled. Exit without changing settings unless the user explicitly requests changes.

- [ ] **Step 5: Smoke-test guardrails with a harmless denied command**

Inside Pi, ask:

```text
Run this exact shell command only if guardrails asks for confirmation: sudo true
```

Expected: guardrails prompts for confirmation before allowing `sudo true`. Deny the prompt. Pi should report that the command was blocked or denied.

---

### Task 6: Final verification and summary

**Files:**
- Inspect: repository state only.

- [ ] **Step 1: Confirm repository status**

Run:

```bash
git status --short
```

Expected: no uncommitted changes from this plan. If stow changed only symlink targets in `$HOME`, that should not affect this repository.

- [ ] **Step 2: Review recent commits**

Run:

```bash
git log --oneline -3
```

Expected: includes commits similar to:

```text
<hash> feat(root): add pi guardrails config
<hash> feat(root): configure pi power user baseline
<hash> docs(root): add pi setup recommendation spec
```

- [ ] **Step 3: Report final status to the user**

Summarize:

```text
Implemented Pi power-user baseline:
- Pinned pi-web-access, @aliou/pi-guardrails, and pi-subagents in dotfiles-managed settings.
- Added guardrails config for secret files, destructive command confirmation, and ask-mode path access.
- Validated JSON and stow simulation.
- Smoke-tested Pi package loading, web access, subagents, and guardrails.
```

If any smoke test failed, include the exact command, failure output, and whether the repository changes were still committed.
