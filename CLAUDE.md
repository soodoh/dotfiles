# Repository guidance

## Overview

Personal dotfiles managed by mise for two explicit macOS profiles: `personal-macos` and `work-macos`. `mise.toml`, the environment-specific configs, committed locks, and `dotfiles/` are canonical.

Do not introduce a default profile, username inference, a pre-mise installer, Stow, Ansible, Make, or another orchestration layer. Small scripts must be invoked by mise tasks/hooks.

The common tool and dotfile layer must remain Linux-compatible. macOS packages, settings, applications, and services stay platform-scoped.

## Layout

- `mise.toml`, `mise.*-macos.toml`, `mise*.lock` — tools, profiles, bootstrap, tasks, and locks
- `dotfiles/common/` — portable Fish, Neovim, tmux, and CLI configuration
- `dotfiles/darwin/` — AeroSpace, SketchyBar, and Colima configuration
- `dotfiles/profiles/` — Git identity and profile-specific agent configuration
- `pi-extensions/` — local Pi package and npm lock
- `packages/work-mcp-servers/` — local work MCP package and npm lock
- `packages/google-calendar/` — tracked work launcher
- `scripts/bootstrap/`, `scripts/update/`, `scripts/validate/` — mise-only imperative gaps
- `docs/migration-parity.md` — parity ledger and accepted tradeoffs
- `docs/cutover.md` — later manual workstation cutover

## Commands

```bash
mise --env personal-macos run status
mise --env personal-macos bootstrap
mise --env work-macos run status
mise --env work-macos bootstrap
mise run validate
mise --env personal-macos run update
```

Never run a workstation bootstrap during repository-only implementation or CI. CI may install bounded dependencies on ephemeral runners but must not alter a login shell, Dock, login items, services, or App Store applications.

Normal bootstrap installs/reconciles without pruning undeclared state or broadly upgrading existing apps. App and App Store upgrades are explicit tasks.

## Neovim and Fish

lazy.nvim is the sole Neovim plugin manager; `lazy-lock.json` is committed. Tree-sitter manages parsers, while mise owns LSP servers, formatters, and linters. Do not add Mason or another plugin manager.

Fish configuration and vendored plugins are symlinked from `dotfiles/common`. Keep secrets only in local `~/.config/fish/conf.d/00-secrets.fish`.

## Pi and agents

Pi settings, workflows, and skills point directly into the checkout. Runtime Pi changes may dirty tracked files; review or revert them with Git. Preserve personal skill filtering, full work catalog behavior, local npm lockfiles, bundled resource aggregation, and the documented work HTTP expected-failure test.

## Commit standards

Commits use `type(scope): message` with scopes `root`, `mise`, `agents`, `nvim`, `mac`, `shell`, or `tmux`. Never add `Co-authored-by` trailers.
