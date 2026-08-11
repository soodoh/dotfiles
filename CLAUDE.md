# Repository guidance

## Overview

Personal dotfiles managed by one pinned Nix flake for personal/work macOS and personal Arch/Debian. macOS uses nix-darwin plus Home Manager; Linux uses standalone Home Manager without NixOS. Minimal GUI fallbacks use nix-homebrew, and MAS uses the Nix-provided `mas` CLI.

The repository is in a gated parallel-migration phase. Legacy automation remains quarantined until the personal Mac switch, smoke tests, audit review, all host builds, and CI are confirmed. Never execute destructive cleanup or delete legacy inputs before that gate.

## Layout

- `flake.nix`, `flake.lock` — pinned inputs and four public configurations
- `nix/hosts/` — explicit host metadata and application sets
- `nix/modules/` — shared, Darwin, Linux, and profile modules
- `nix/packages/` — pinned Pi, ReadSeek, TWG, and Pi extension packages
- `nix/dotfiles/` — store-backed common, Darwin, and isolated profile files
- `nix/scripts/` — read-only audit and confirmation-gated cleanup
- `bootstrap/nix-*.sh` — official multi-user Nix bootstraps during migration
- `bin/nix-*` — switch, update, validate, audit, and cleanup entrypoints

## Commands

```bash
./bin/nix-switch-personal-macos
./bin/nix-switch-work-macos
./bin/nix-switch-personal-arch
./bin/nix-switch-personal-debian
./bin/nix-update lock
./bin/nix-validate
./bin/nix-audit personal-macos
./bin/nix-cleanup personal-macos
```

Normal switch operations are non-destructive. Cleanup must regenerate a plan and require `CLEAN`. Never remove Docker Desktop until Colima, `hello-world`, and Compose verification pass.

## Neovim and Fish

Neovim plugins, Tree-sitter grammars, LSP servers, formatters, and linters are Nix packages. Do not reintroduce mutable plugin/tool bootstrapping.

Fish configuration/plugins are store-backed. Linux Fish remains a native login-shell package; Home Manager does not manage `/etc/shells`. Keep secrets only in local `~/.config/fish/conf.d/00-secrets.fish`.

## Commit standards

Commits use `type(scope): message` with scopes `root`, `agents`, `nvim`, `mac`, `shell`, or `tmux`. Never add `Co-authored-by` trailers.
