# Repository guidance

## Overview

Personal dotfiles managed by one pinned Nix flake for personal/work macOS and personal Arch/Debian. macOS uses nix-darwin plus Home Manager; Linux uses standalone Home Manager without NixOS. Minimal GUI fallbacks use nix-homebrew, and MAS uses the Nix-provided `mas` CLI.

The Nix migration is complete. The flake and `nix/dotfiles/` are the canonical configuration; do not reintroduce parallel legacy automation or mutable package/plugin bootstrapping.

## Layout

- `flake.nix`, `flake.lock` — pinned inputs and four public configurations
- `nix/hosts/` — explicit host metadata and application sets
- `nix/modules/` — shared, Darwin, Linux, and profile modules
- `nix/packages/` — pinned TWG and Pi extension packages
- `nix/dotfiles/` — store-backed common, Darwin, shared agent, and profile-specific files
- `nix/scripts/` — read-only external-state reporting
- `bootstrap/nix-*.sh` — official multi-user Nix bootstraps
- `bin/nix-*` — switch, update, validate, and audit entrypoints

## Commands

```bash
./bin/nix-switch-personal-macos
./bin/nix-switch-work-macos
./bin/nix-switch-personal-arch
./bin/nix-switch-personal-debian
./bin/nix-update lock
./bin/nix-validate
./bin/nix-audit personal-macos
```

Normal switch operations do not remove unmanaged software. Audit reports external and missing state; the operator decides how to handle it manually.

## Neovim and Fish

Neovim plugins, Tree-sitter grammars, LSP servers, formatters, and linters are Nix packages. Do not reintroduce mutable plugin/tool bootstrapping.

Fish configuration/plugins are store-backed. Linux Fish remains a native login-shell package; Home Manager does not manage `/etc/shells`. Keep secrets only in local `~/.config/fish/conf.d/00-secrets.fish`.

## Commit standards

Commits use `type(scope): message` with scopes `root`, `agents`, `nvim`, `mac`, `shell`, or `tmux`. Never add `Co-authored-by` trailers.
