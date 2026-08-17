#!/usr/bin/env bash
set -euo pipefail

profile=${DOTFILES_PROFILE:-${MISE_ENV:-}}
case $profile in
  personal-macos)
    items=(
      "Lunar|/Applications/Lunar.app"
      "Nextcloud|/Applications/Nextcloud.app"
      "Tailscale|/Applications/Tailscale.app"
    )
    ;;
  work-macos)
    items=(
      "Lunar|/Applications/Lunar.app"
      "Nextcloud|/Applications/Nextcloud.app"
    )
    ;;
  *)
    printf 'error: unsupported profile: %s\n' "${profile:-unset}" >&2
    exit 64
    ;;
esac

for record in "${items[@]}"; do
  name=${record%%|*}
  path=${record#*|}
  if [[ ! -e $path ]]; then
    printf 'warning: login item application is missing: %s\n' "$path" >&2
    continue
  fi
  /usr/bin/osascript - "$name" "$path" <<'APPLESCRIPT'
on run argv
  set itemName to item 1 of argv
  set itemPath to item 2 of argv
  tell application "System Events"
    if not (exists login item itemName) then
      make login item at end with properties {name:itemName, path:itemPath, hidden:false}
    end if
  end tell
end run
APPLESCRIPT
done
