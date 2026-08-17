#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
[[ $# -le 1 ]] || { printf 'usage: %s [profile]\n' "$0" >&2; exit 64; }
profile=${1:-${DOTFILES_PROFILE:-${MISE_ENV:-}}}
"$repo_root/scripts/bootstrap/require-profile.sh" "$profile"
missing=0

report_command() {
  local command=$1
  if command -v "$command" >/dev/null 2>&1; then
    printf 'ok      command %s -> %s\n' "$command" "$(command -v "$command")"
  else
    printf 'missing command %s\n' "$command"
    missing=1
  fi
}

report_link() {
  local target=$1 source=$2 actual
  source=$(cd "$(dirname "$source")" && pwd -P)/$(basename "$source")
  if [[ ! -L $target ]]; then
    printf 'missing link %s -> %s\n' "$target" "$source"
    missing=1
    return
  fi
  actual=$(readlink "$target")
  [[ $actual == /* ]] || actual=$(cd "$(dirname "$target")" && cd "$(dirname "$actual")" && pwd -P)/$(basename "$actual")
  if [[ $actual == "$source" ]]; then
    printf 'ok      link %s\n' "$target"
  else
    printf 'differs link %s -> %s (wanted %s)\n' "$target" "$actual" "$source"
    missing=1
  fi
}

for command in node npm bun python3 go rustc cargo gh jq rg fzf atuin lazygit starship zoxide sesh yazi nvim tree-sitter pi playwright-mcp fish tmux aerospace sketchybar borders colima docker; do
  report_command "$command"
done
if [[ ${profile} == personal-macos ]]; then
  report_command aws
else
  for command in az azure-mcp gcloud snow mcp-server-azuredevops kusto-mcp figma-developer-mcp twg; do
    report_command "$command"
  done
fi

report_link "$HOME/.config/fish/conf.d/10-mise-profile.fish" "$repo_root/dotfiles/profiles/${profile%-macos}/.config/fish/conf.d/10-mise-profile.fish"
report_link "$HOME/.config/nvim" "$repo_root/dotfiles/common/.config/nvim"
report_link "$HOME/.config/tmux" "$repo_root/dotfiles/common/.config/tmux"
report_link "$HOME/.pi/agent/pi-extensions" "$repo_root/pi-extensions"
report_link "$HOME/.pi/agent/settings.json" "$repo_root/dotfiles/profiles/${profile%-macos}/.pi/agent/settings.json"
report_link "$HOME/.gitconfig" "$repo_root/dotfiles/profiles/${profile%-macos}/.gitconfig"

if [[ $(uname -s) == Darwin ]]; then
  for app in Ghostty Obsidian Lunar Nextcloud Zen; do
    if [[ -d /Applications/$app.app ]]; then
      printf 'ok      app %s\n' "$app"
    else
      printf 'missing app /Applications/%s.app\n' "$app"
      missing=1
    fi
  done
  current_shell=$(dscl . -read "$HOME" UserShell 2>/dev/null | awk '{print $2}')
  if [[ $current_shell == /opt/homebrew/bin/fish ]]; then
    printf 'ok      login shell %s\n' "$current_shell"
  else
    printf 'differs login shell %s (wanted /opt/homebrew/bin/fish)\n' "${current_shell:-unknown}"
    missing=1
  fi
  if [[ ${profile} == work-macos ]]; then
    "$repo_root/scripts/bootstrap/work-ca-preflight.sh" || missing=1
    for app in 'Tailscale' 'Google Chrome' 'Slack' 'Privileges'; do
      [[ -d /Applications/$app.app ]] || printf 'external/MDM app missing: /Applications/%s.app\n' "$app"
    done
  fi
fi

exit "$missing"
