# Repository guidance

## Overview

Personal dotfiles managed by mise for two explicit macOS profiles: `personal-macos` and `work-macos`. `mise.toml`, the environment-specific configs, committed locks, and `dotfiles/` are canonical.

Do not introduce a default profile, username inference, a pre-mise installer, Stow, Ansible, Make, another orchestration layer, or a top-level `scripts/` directory. Prefer native mise declarations and concise TOML tasks; keep genuine tests beside the code or configuration they verify.

The common tool and dotfile layer must remain Linux-compatible. macOS packages, settings, applications, and services stay platform-scoped.

## Layout

- `mise.toml`, `mise.*-macos.toml`, `mise*.lock` — tools, profiles, bootstrap, tasks, and locks
- `dotfiles/common/` — portable Fish, Neovim, tmux, Pi, and CLI configuration
- `dotfiles/macos/` — AeroSpace, SketchyBar, and Colima configuration
- `dotfiles/personal/`, `dotfiles/work/` — profile identity, Pi settings, complete agent catalogs, and work-only apps
- `pi-extensions/` — local Pi package and npm lock
- `docs/migration-parity.md` — parity ledger and accepted tradeoffs
- `docs/cutover.md` — later manual workstation cutover

## Commands

```bash
mise --env personal-macos run status
MISE_ENV=personal-macos mise bootstrap
mise --env work-macos run status
MISE_ENV=work-macos mise bootstrap
mise run validate
mise --env personal-macos run update
```

Never run a workstation bootstrap during repository-only implementation or CI. CI may install bounded dependencies on ephemeral runners but must not alter a login shell, Dock, login items, services, or App Store applications.

Normal bootstrap installs/reconciles without pruning undeclared state or broadly upgrading existing apps. The grouped update task upgrades declared packages explicitly. Dock order and login items are user-owned.

## Neovim and Fish

lazy.nvim is the sole Neovim plugin manager; `lazy-lock.json` is committed. Tree-sitter manages parsers, while mise owns LSP servers, formatters, and linters. Do not add Mason or another plugin manager.

Fish configuration and vendored plugins are symlinked from `dotfiles/common`. Keep secrets only in local `~/.config/fish/conf.d/00-secrets.fish`.

## Pi and agents

Pi settings, workflows, and profile-specific complete skill catalogs point directly into the checkout. Runtime Pi changes may dirty tracked files; review or revert them with Git. Preserve local npm locks, explicit bundled resource paths, and the documented work HTTP expected-failure test.

## Commit standards

Commits use `type(scope): message` with scopes `root`, `mise`, `agents`, `nvim`, `mac`, `shell`, or `tmux`. Never add `Co-authored-by` trailers.
