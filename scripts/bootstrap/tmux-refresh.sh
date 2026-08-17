#!/usr/bin/env bash
set -euo pipefail

command -v tmux >/dev/null || exit 0
if tmux has-session 2>/dev/null; then
  tmux set-environment -g PATH "$PATH"
  if command -v fish >/dev/null; then
    fish_path=$(command -v fish)
    tmux set-environment -g SHELL "$fish_path"
    tmux set-option -g default-shell "$fish_path"
  fi
  tmux source-file "$HOME/.config/tmux/tmux.conf"
fi
