#!/bin/sh
if [ -z "${BASH_VERSION:-}" ] || shopt -oq posix; then
  exec /bin/bash "$0" "$@"
fi

set -euo pipefail

source "$CONFIG_DIR/plugins/aerospace_workspace_icons.sh"

refresh_workspace() {
  local workspace_id="$1"
  [[ -z "$workspace_id" ]] && return

  render_workspace_items "$workspace_id" "$(aerospace list-windows --workspace "$workspace_id" --format '%{workspace}|%{app-name}|%{app-bundle-id}' | extract_workspace_apps_from_windows)"
}

refresh_all_workspaces() {
  local focused_workspace=""
  local workspace_snapshot=""
  focused_workspace="$(aerospace list-workspaces --focused 2>/dev/null || true)"

  if workspace_snapshot="$(aerospace list-windows --all --format '%{workspace}|%{app-name}|%{app-bundle-id}' 2>/dev/null)"; then
    while IFS= read -r workspace_id; do
      [[ -n "$workspace_id" ]] || continue

      local workspace_apps=""
      if [[ -n "$workspace_snapshot" ]]; then
        workspace_apps="$(awk -F'|' -v workspace_id="$workspace_id" '
          function trim(value) {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            return value
          }
          $1 == workspace_id {
            app_name = trim($2)
            bundle_id = trim($3)
            if (app_name != "" || bundle_id != "") {
              print app_name "|" bundle_id
            }
          }
        ' <<<"$workspace_snapshot")"
      fi

      render_workspace_items "$workspace_id" "$workspace_apps"
      NAME="space.$workspace_id" FOCUSED_WORKSPACE="$focused_workspace" "$CONFIG_DIR/plugins/aerospace.sh" "$workspace_id"
    done < <(aerospace list-workspaces --all)
    return
  fi

  while IFS= read -r workspace_id; do
    [[ -n "$workspace_id" ]] || continue

    refresh_workspace "$workspace_id"
    NAME="space.$workspace_id" FOCUSED_WORKSPACE="$focused_workspace" "$CONFIG_DIR/plugins/aerospace.sh" "$workspace_id"
  done < <(aerospace list-workspaces --all)
}

if [[ "${1:-}" == "--all" ]]; then
  refresh_all_workspaces
elif [[ "${SENDER:-}" == "aerospace_workspace_change" ]]; then
  refresh_workspace "${PREV_WORKSPACE:-}"
  refresh_workspace "${FOCUSED_WORKSPACE:-}"
fi
