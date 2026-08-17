#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
[[ $# -le 1 ]] || { printf 'usage: %s [profile]\n' "$0" >&2; exit 64; }
profile=${1:-${DOTFILES_PROFILE:-${MISE_ENV:-}}}
"$repo_root/scripts/bootstrap/require-profile.sh" --explicit "$profile"
export DOTFILES_PROFILE=$profile
"$repo_root/scripts/bootstrap/require-macos.sh"

export HOMEBREW_NO_AUTO_UPDATE=1
while IFS='|' read -r token specification; do
  if brew list --cask --versions "$token" >/dev/null 2>&1; then
    brew upgrade --cask "$specification"
  fi
done < <("$repo_root/scripts/bootstrap/macos/homebrew-app-manifest.sh" "$profile")

brew upgrade FelixKratz/formulae/sketchybar FelixKratz/formulae/borders
