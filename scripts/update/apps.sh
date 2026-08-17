#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
[[ $# -le 1 ]] || { printf 'usage: %s [profile]\n' "$0" >&2; exit 64; }
profile=${1:-${DOTFILES_PROFILE:-${MISE_ENV:-}}}
"$repo_root/scripts/bootstrap/require-profile.sh" --explicit "$profile"
export DOTFILES_PROFILE=$profile
"$repo_root/scripts/bootstrap/require-macos.sh"

mise --env "$profile" bootstrap packages upgrade --manager brew-cask
export HOMEBREW_NO_AUTO_UPDATE=1
brew upgrade --cask nikitabobko/tap/aerospace
brew upgrade FelixKratz/formulae/sketchybar FelixKratz/formulae/borders
if [[ $profile == work-macos ]]; then
  brew upgrade --cask snowflakedb/snowflake-cli/snowflake-cli
fi
