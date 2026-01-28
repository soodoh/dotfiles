# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Personal dotfiles for cross-platform development environments (macOS, Linux Debian/Ubuntu/Arch). Uses GNU Stow for symlink-based config management.

## Structure

- `unix-configs/` - Universal configs symlinked via `stow -vRt $HOME unix-configs`
- `mac-configs/` - macOS-specific configs symlinked via `stow -vRt $HOME mac-configs`
- `sway-configs/` - Optional Sway window manager configs

Key tools configured: Neovim (Lua/lazy.nvim), Zsh (Antidote plugin manager), Tmux (C-g prefix), Ghostty terminal, Starship prompt, Aerospace (macOS tiling WM), Sketchybar.

## Commit Standards

Commits are linted via commitlint with conventional commits format:

```
type(scope): message
```

**Valid scopes**: `root`, `nvim`, `mac`, `zsh`, `tmux`

Pre-commit hook runs: `pnpm exec commitlint --edit`

## Commands

```bash
# Install dependencies (needed for commit hooks)
pnpm install

# Apply unix configs
stow -vRt $HOME unix-configs

# Apply macOS configs (run after unix-configs)
stow -vRt $HOME mac-configs

# Remove symlinks
stow -Dt $HOME unix-configs
```

## Neovim Configuration

Located at `unix-configs/.config/nvim/`. Uses lazy.nvim plugin manager with modular structure:
- `lua/plugins/lsp/` - Language servers (Mason, lspconfig, blink.cmp)
- `lua/plugins/productivity/` - Dev tools (Telescope, Copilot, flash.nvim)
- `lua/plugins/ui/` - UI components (lualine, bufferline, dashboard)

After changes, run `:Lazy` in Neovim to sync plugins.

## Zsh Configuration

Located at `unix-configs/.config/zsh/`. Uses Antidote plugin manager which auto-installs on first shell load. Plugin list in `.zsh_plugins.txt`.

## Tmux Configuration

Located at `unix-configs/.config/tmux/`. Uses TPM (Tmux Plugin Manager) which auto-installs. Prefix key is `C-g`.
