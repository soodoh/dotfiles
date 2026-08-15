# Repository guidance

## Overview

Personal dotfiles managed by one pinned Nix flake for personal/work macOS. Both hosts use nix-darwin plus Home Manager. Minimal GUI fallbacks use nix-homebrew, and MAS uses the Nix-provided `mas` CLI.

The Nix migration is complete. The flake and `nix/dotfiles/` are the canonical configuration; do not reintroduce parallel legacy automation or mutable package/plugin bootstrapping.

The shared user environment is exported as `homeModules.default` with profile additions under `homeModules.personal` and `homeModules.work`. Darwin hosts must keep importing these modules rather than duplicating package, Neovim, Fish, or agent configuration; future NixOS hosts should reuse the same modules and overlay.

## Layout

- `flake.nix`, `flake.lock` — pinned inputs and two public Darwin configurations
- `nix/hosts/` — explicit host metadata and application sets
- `nix/modules/` — reusable Home Manager, Darwin, and profile modules
- `nix/packages/` — pinned TWG and Pi extension packages
- `nix/dotfiles/` — store-backed common, Darwin, shared agent, and profile-specific files
- `nix/scripts/` — read-only external-state reporting
- `bootstrap/nix-macos.sh` — official multi-user Nix bootstrap
- `bin/nix-*` — switch, update, validate, and audit entrypoints

## Commands

```bash
./bin/nix-switch-personal-macos
./bin/nix-switch-work-macos
./bin/nix-update lock
./bin/nix-validate
./bin/nix-audit personal-macos
```

Normal switch operations do not remove unmanaged software. Audit reports external and missing state; the operator decides how to handle it manually.

## Neovim and Fish

Neovim plugins, Tree-sitter grammars, LSP servers, formatters, and linters are Nix packages. Do not reintroduce mutable plugin/tool bootstrapping.

Fish configuration/plugins are store-backed and shared through the reusable Home Manager module. Keep secrets only in local `~/.config/fish/conf.d/00-secrets.fish`.

## Commit standards

Commits use `type(scope): message` with scopes `root`, `nix`, `agents`, `nvim`, `mac`, `shell`, or `tmux`. Never add `Co-authored-by` trailers.
