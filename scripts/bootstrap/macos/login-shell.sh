#!/usr/bin/env bash
set -euo pipefail

fish_path=/opt/homebrew/bin/fish
if [[ ! -x $fish_path ]]; then
  printf 'error: Fish is not installed at %s\n' "$fish_path" >&2
  exit 69
fi

if ! grep -Fqx "$fish_path" /etc/shells; then
  printf '%s\n' "$fish_path" | sudo tee -a /etc/shells >/dev/null
fi
