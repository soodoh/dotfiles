#!/usr/bin/env bash
set -euo pipefail

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ANALYTICS=1
export HOMEBREW_NO_ENV_HINTS=1

if ! command -v brew >/dev/null 2>&1; then
  printf 'Homebrew CLI is required for taps without mise-compatible API metadata; installing it now.\n' >&2
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi
command -v brew >/dev/null || {
  printf 'error: Homebrew CLI installation did not provide brew\n' >&2
  exit 69
}

install_cask_if_missing() {
  local token=$1 specification=$2
  brew list --cask --versions "$token" >/dev/null 2>&1 || brew install --cask "$specification"
}

install_formula_if_missing() {
  local formula=$1 specification=$2
  brew list --formula --versions "$formula" >/dev/null 2>&1 || brew install "$specification"
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
profile=${DOTFILES_PROFILE:-${MISE_ENV:-}}

brew tap nikitabobko/tap
brew tap FelixKratz/formulae
if [[ $profile == work-macos ]]; then
  brew tap snowflakedb/snowflake-cli
fi

while IFS='|' read -r token specification; do
  install_cask_if_missing "$token" "$specification"
done < <("$repo_root/scripts/bootstrap/macos/homebrew-app-manifest.sh" "$profile")

install_formula_if_missing sketchybar FelixKratz/formulae/sketchybar
install_formula_if_missing borders FelixKratz/formulae/borders
