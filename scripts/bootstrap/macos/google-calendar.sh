#!/usr/bin/env bash
set -euo pipefail

profile=${DOTFILES_PROFILE:-${MISE_ENV:-}}
[[ $profile == work-macos ]] || exit 0
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
source_app="$repo_root/packages/google-calendar/Google Calendar.app"
target_root="$HOME/Applications"
target_app="$target_root/Google Calendar.app"

mkdir -p "$target_root"
if [[ ! -d $target_app ]] || ! diff -qr "$source_app" "$target_app" >/dev/null 2>&1; then
  temp_app="$target_root/.Google Calendar.app.mise.$$"
  rm -rf "$temp_app"
  /usr/bin/ditto "$source_app" "$temp_app"
  rm -rf "$target_app"
  mv "$temp_app" "$target_app"
fi
