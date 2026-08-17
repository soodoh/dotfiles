#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
[[ $# -le 1 ]] || { printf 'usage: %s [profile]\n' "$0" >&2; exit 64; }
profile=${1:-${DOTFILES_PROFILE:-${MISE_ENV:-}}}
"$repo_root/scripts/bootstrap/require-profile.sh" --explicit "$profile"
export DOTFILES_PROFILE=$profile
"$repo_root/scripts/bootstrap/require-macos.sh"
"$repo_root/scripts/bootstrap/work-ca-preflight.sh"

npm ci --prefix "$repo_root" --ignore-scripts --no-audit --no-fund
npm ci --prefix "$repo_root/pi-extensions" --legacy-peer-deps --no-audit --no-fund
node "$repo_root/scripts/bootstrap/pi-extensions.mjs"
if [[ $profile == work-macos ]]; then
  npm ci --prefix "$repo_root/packages/work-mcp-servers" --no-audit --no-fund
fi
node "$repo_root/scripts/bootstrap/validate-agents.mjs"
"$repo_root/scripts/bootstrap/validate-readseek.sh"

"$repo_root/scripts/bootstrap/macos/third-party-homebrew.sh"
"$repo_root/scripts/bootstrap/macos/google-calendar.sh"
"$repo_root/scripts/bootstrap/macos/dock.sh"
"$repo_root/scripts/bootstrap/macos/login-items.sh"
"$repo_root/scripts/bootstrap/macos/services.sh"
"$repo_root/scripts/bootstrap/tmux-refresh.sh"

printf 'Bootstrap reconciliation complete for %s. Open a fresh terminal before smoke testing.\n' "$profile"
