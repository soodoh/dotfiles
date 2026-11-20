#!/bin/bash
set -euo pipefail

source "$CONFIG_DIR/plugins/aerospace_workspace_icons.sh"

generation="$1"
shift
state_dir="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar"
state_file="$state_dir/workspace-apps"
umask 077
mkdir -p "$state_dir"

# Events and timer ticks can overlap. Let the next tick catch up rather than
# allowing two renders (and their cached snapshots) to race.
exec 9>>"$state_file.lock"
case "$OSTYPE" in
  darwin*) lockf -s -t 0 9 || exit 0 ;;
  *) flock -n 9 || exit 0 ;; # Linux validation
esac

# A failed query is not the same as a successful snapshot with no windows.
windows="$(aerospace list-windows --all --format '%{workspace}|%{app-name}|%{app-bundle-id}' 2>/dev/null)" || exit 0
snapshot="$(workspace_app_snapshot <<<"$windows")"
current="$generation"
[[ -z "$snapshot" ]] || current+=$'\n'"$snapshot"

previous=""
if [[ -f "$state_file" ]]; then
  previous="$(<"$state_file")"
fi
[[ "$previous" != "$current" ]] || exit 0
previous_generation="${previous%%$'\n'*}"

# Invalidate before drawing so an interrupted or partial render is repaired
# on the next tick, even if the window set has since returned to its old state.
rm -f "$state_file"
for workspace_id; do
  apps="$(workspace_apps_from_snapshot "$workspace_id" <<<"$snapshot")"
  if [[ "$previous_generation" == "$generation" &&
    "$apps" == "$(workspace_apps_from_snapshot "$workspace_id" <<<"$previous")" ]]; then
    continue
  fi
  render_workspace_items "$workspace_id" "$apps"
done

printf '%s\n' "$current" >"$state_file.tmp"
mv -f "$state_file.tmp" "$state_file"
