#!/bin/sh
if [ -z "${BASH_VERSION:-}" ] || shopt -oq posix; then
  exec /bin/bash "$0" "$@"
fi

set -euo pipefail

source "$CONFIG_DIR/plugins/aerospace_workspace_icons.sh"

refresh_workspace() {
  local workspace_id="$1"
  local keep_visible_when_empty="${2:-false}"
  [[ -z "$workspace_id" ]] && return

  render_workspace_items "$workspace_id" "$(aerospace list-windows --workspace "$workspace_id" | extract_workspace_apps_from_windows)" "$keep_visible_when_empty"
}

if [[ "$SENDER" == "aerospace_workspace_change" ]]; then
  refresh_workspace "${PREV_WORKSPACE:-}"
  refresh_workspace "${FOCUSED_WORKSPACE:-}" true
fi
