#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
until aerospace list-workspaces --all >/dev/null 2>&1; do
  sleep 1
done
exec sketchybar
