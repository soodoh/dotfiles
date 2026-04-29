# Pi Power User Setup Recommendation Design

## Purpose

Create a researched, dotfiles-managed recommendation for configuring Pi as a balanced power-user coding agent. This design produces documentation only. It does not change Pi settings or install packages.

## Current Setup

Current dotfiles-managed Pi settings are in `unix-configs/.pi/agent/settings.json`:

```json
{
  "lastChangelogVersion": "0.70.6",
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.5",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "packages": [
    "npm:pi-web-access"
  ]
}
```

Existing baseline:

- Provider/model: `openai-codex` / `gpt-5.5`
- Thinking level: `medium`
- Theme: `dark`
- Installed package: `npm:pi-web-access`
- Configuration scope: dotfiles-managed under `unix-configs/.pi/agent`

## Recommendation Strategy

Use a curated, moderate-trust package and settings model:

1. Keep the baseline small and reproducible.
2. Prefer packages with clear documentation, focused scope, active maintenance, and obvious rollback.
3. Avoid broad bundles and overlapping tools until there is a specific use case.
4. Treat all Pi packages as trusted code because extensions can run with full system access.
5. Keep recommendations in documentation first; apply changes later through a separate implementation plan.

## Package Recommendation Tiers

### Core Recommended

These are good candidates for the main dotfiles baseline after source review.

#### `npm:pi-web-access`

Status: already installed.

Purpose: web search, URL fetching, GitHub repository content, PDFs, YouTube/video understanding, and local video analysis.

Recommendation: keep it. It supports research-backed answers and complements coding work without replacing core Pi behavior.

#### `npm:@aliou/pi-guardrails`

Purpose: safety hooks for destructive commands and secret-file access.

Useful capabilities:

- Blocks or asks before dangerous commands such as `rm -rf`, `sudo`, `dd`, `mkfs`, broad chmod/chown.
- Protects secret files such as `.env` while allowing examples and samples.
- Can optionally restrict tool access outside the current working directory.
- Provides interactive settings via `/guardrails:settings`.

Recommendation: likely adopt as the default safety layer after review. Prefer this over heavier sandboxing for daily use because it targets common accidental-risk cases with less workflow disruption.

#### `npm:pi-subagents`

Purpose: focused child agents for scouting, reviewing, research, planning, implementation, and second opinions.

Useful capabilities:

- Built-in agents: `scout`, `researcher`, `planner`, `worker`, `reviewer`, `oracle`, and others.
- Natural-language delegation.
- Foreground/background runs.
- Chains and parallel runs.
- Optional integration with `pi-web-access` for researcher workflows.
- Optional worktree isolation for parallel implementation.

Recommendation: likely adopt as the primary subagent package. It is a better first choice than heavier orchestration systems because it supports common workflows without requiring a full task-orchestration project structure.

#### `npm:pi-ask-me`

Purpose: structured, tabbed TUI for multi-question decisions.

Useful capabilities:

- Lets the model ask grouped, structured questions.
- Supports custom answers.
- Supports a chat branch escape hatch using Pi session tree behavior.

Recommendation: adopt only if Pi clarification flows feel too linear. It is useful for design and planning conversations, but not essential for the initial baseline.

### Optional Evaluate

These are useful but should not be part of the first baseline unless a specific workflow needs them.

#### `npm:taskplane`

Purpose: multi-agent task orchestration with worktrees, task packets, reviewers, merge flow, and dashboard.

Recommendation: evaluate for large multi-step projects. Do not install by default in this dotfiles baseline because it introduces a heavier workflow and project scaffolding.

#### `npm:pi-mcp-adapter`

Purpose: MCP adapter for Pi.

Recommendation: evaluate when there are specific MCP servers to use, such as browser tools, GitHub tools, or local knowledge/context tools. Do not install solely because MCP exists.

#### `npm:pi-lens`

Purpose: real-time code feedback via LSP, linters, formatters, type-checking, and structural analysis.

Recommendation: evaluate if Pi sessions would benefit from continuous local diagnostics. Confirm overlap with existing editor/LSP workflows before adopting.

#### `npm:pi-powerline-footer`

Purpose: improved status/footer display.

Recommendation: evaluate for TUI ergonomics only. It is low conceptual risk but not necessary for capability.

#### `npm:@ifi/oh-pi-themes`

Purpose: theme collection.

Recommendation: evaluate if the built-in `dark` theme is not ideal. Prefer one selected theme over loading many visual packages.

#### `npm:@ifi/oh-pi-prompts` and `npm:@ifi/oh-pi-skills`

Purpose: prompt and skill packs.

Recommendation: evaluate carefully because this repository already has a mature Superpowers-style skill workflow. Avoid duplicating or weakening existing process discipline.

### Defer or Avoid Initially

Avoid these for the first pass unless a clear use case appears:

- Broad “install everything” bundles.
- Autonomous loop and swarm packages.
- Heavy container/sandbox packages for normal daily use.
- Duplicate web-search packages while `pi-web-access` satisfies the need.
- Packages that register many write/shell/spawn tools without a focused workflow benefit.

## Settings Recommendations

### Keep

- Keep `defaultThinkingLevel: "medium"` as the balanced default.
- Keep settings dotfiles-managed under `unix-configs/.pi/agent/settings.json`.
- Keep `theme: "dark"` unless a specific custom theme is chosen.

### Consider Adding Later

#### Compaction

Add explicit compaction settings if long sessions become common:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

This makes long-session behavior explicit instead of relying on defaults.

#### Retry

Add retry settings only if provider requests frequently fail or hang:

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "provider": {
      "maxRetryDelayMs": 60000
    }
  }
}
```

#### Model Cycling

Use `enabledModels` after choosing 2–4 daily-driver models for Ctrl+P cycling. Recommended shape:

```json
{
  "enabledModels": [
    "gpt-5.5",
    "claude-*sonnet*",
    "gemini-2*"
  ]
}
```

The exact list should be based on authenticated providers and tested model quality.

#### Startup and Display

Recommended defaults:

- Leave `quietStartup` disabled so loaded packages, skills, extensions, and context files remain visible.
- Consider `collapseChangelog: true` if changelog output becomes noisy.
- Consider `hideThinkingBlock: true` only if thinking output becomes distracting. Leave thinking visible by default for auditability.

## Workflow Recommendations

### Research

Use `pi-web-access` for claims that require current or external evidence. Prefer multi-query research for broad package comparisons and fetch package READMEs for promising candidates.

### Safety

Use guardrails for:

- Secret-file protection.
- Destructive shell command confirmation.
- Optional path-access restrictions for unfamiliar repositories.

Do not rely on guardrails as a complete sandbox. It is a safety net, not a security boundary.

### Subagents

Use subagents selectively:

- `scout` before planning work in unfamiliar code.
- `researcher` when external docs matter.
- `oracle` for second opinions on risky plans.
- `reviewer` after implementation.
- Parallel reviewers for larger diffs with separate correctness, tests, and simplicity angles.

Do not use subagents for every small edit. They add value when independent context, parallel review, or fresh perspective matters.

### Existing Skills

Keep the existing local/Superpowers-style skills as the primary disciplined development workflow. Pi packages should enhance Pi-specific UX and tooling rather than replace established processes for brainstorming, planning, debugging, TDD, review, and verification.

## Package Review Policy

Before adding a package to the dotfiles baseline, review:

1. README and command/tool surface.
2. npm or git source and version history.
3. Whether the package registers tools that can write files, run shell commands, spawn agents, or access the network.
4. Overlap with existing packages, skills, prompts, or editor workflows.
5. Configuration and rollback path.
6. Whether the package should be pinned to a version.

Prefer pinned versions for packages that affect safety, orchestration, model execution, or tool execution.

## Update and Rollback Policy

Recommended operating model:

- Keep stable package choices in dotfiles-managed settings.
- Keep experimental packages out of the main baseline until they prove useful.
- Use `pi list` to inspect installed packages.
- Use `/reload` after settings/package changes.
- Use package-specific doctor/status commands where available.
- Roll back by removing the package entry from settings, running `/reload`, and optionally running `pi remove` for the package source.

## Future Implementation Validation

If this recommendation is later implemented, validate with:

1. JSON syntax check for `unix-configs/.pi/agent/settings.json`.
2. `pi list` to confirm package resolution.
3. Pi startup check to confirm expected packages, skills, and extensions load.
4. Package doctor/status commands:
   - `/subagents-doctor` if `pi-subagents` is installed.
   - `/guardrails:settings` or equivalent guardrails status/config UI if guardrails is installed.
5. A small smoke test:
   - Ask Pi to perform a web search.
   - Ask Pi to identify available subagents.
   - Trigger a harmless guardrails confirmation scenario if configured.
6. Confirm there are no confusing duplicate tools or overlapping prompt commands.

## Recommended Initial Adoption Plan

When implementation is approved later, adopt in this order:

1. Keep `pi-web-access`.
2. Add and configure `@aliou/pi-guardrails`.
3. Add and test `pi-subagents`.
4. Optionally add `pi-ask-me` if structured decision prompts are desired.
5. Evaluate UX packages such as themes or footer enhancements.
6. Defer Taskplane, MCP, and large bundles until a specific project needs them.
