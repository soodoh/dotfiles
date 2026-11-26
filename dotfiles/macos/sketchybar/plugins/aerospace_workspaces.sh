#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename -- "${BASH_SOURCE[0]}")"
source "$SCRIPT_DIR/colors.sh"

MAX_VISIBLE_WORKSPACE_APPS=4
GENERIC_APP_ICON="/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns"
WORKSPACE_GROUP_GAP=8
WORKSPACE_GROUP_PADDING_X=8
EMPTY_WORKSPACE_GROUP_WIDTH=12
WORKSPACE_ICON_PADDING_X=1
WORKSPACE_ICON_SCALE=0.65
APP_ICON_PIXEL_SIZE=32

STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar"
APP_ICON_CACHE_DIR="$STATE_DIR/app-icons"

plistbuddy_bin() {
  if command -v PlistBuddy >/dev/null 2>&1; then
    printf 'PlistBuddy\n'
  else
    printf '/usr/libexec/PlistBuddy\n'
  fi
}

workspace_app_snapshot() {
  # Order by app name within each workspace so window order cannot move icons.
  LC_ALL=C sort -t '|' -k1,1 -k2,2 -k3,3 | awk -F'|' '
    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    $1 != "" {
      app_name = trim($2)
      bundle_id = trim($3)
      identity = bundle_id != "" ? bundle_id : app_name
      if (identity != "" && !seen[$1, identity]++) {
        print $1 "|" app_name "|" bundle_id
      }
    }
  '
}

workspace_apps_from_snapshot() {
  awk -v prefix="$1|" 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1) }'
}

find_app_bundle() {
  local bundle_id="$1"
  local candidate

  [[ -n "$bundle_id" ]] || return 1
  command -v mdfind >/dev/null 2>&1 || return 1
  while IFS= read -r candidate; do
    if [[ -d "$candidate/Contents/Resources" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(mdfind "kMDItemCFBundleIdentifier == '$bundle_id'" 2>/dev/null)

  return 1
}

find_app_icon_resource() {
  local bundle_id="$1"
  local app_bundle
  local plistbuddy
  local icon_file
  local icon_path

  app_bundle="$(find_app_bundle "$bundle_id")" || return 1
  plistbuddy="$(plistbuddy_bin)"
  [[ -x "$plistbuddy" ]] || command -v "$plistbuddy" >/dev/null 2>&1 || return 1
  icon_file="$("$plistbuddy" -c 'Print :CFBundleIconFile' "$app_bundle/Contents/Info.plist" 2>/dev/null)" || return 1
  [[ -n "$icon_file" ]] || return 1

  icon_path="$app_bundle/Contents/Resources/$icon_file"
  if [[ ! -f "$icon_path" && "$icon_file" != *.icns ]]; then
    icon_path="$icon_path.icns"
  fi
  [[ -f "$icon_path" ]] || return 1
  printf '%s\n' "$icon_path"
}

cache_app_icon() {
  local bundle_id="$1"
  local icon_resource="$2"
  local cache_name
  local cache_path
  local temporary_path

  cache_name="$(printf '%s' "$bundle_id" | LC_ALL=C tr -c 'A-Za-z0-9._-' '_')"
  cache_path="$APP_ICON_CACHE_DIR/$cache_name.png"

  if [[ -f "$cache_path" && ! "$icon_resource" -nt "$cache_path" ]]; then
    printf '%s\n' "$cache_path"
    return 0
  fi

  command -v sips >/dev/null 2>&1 || return 1
  mkdir -p "$APP_ICON_CACHE_DIR" || return 1
  temporary_path="$(mktemp "$APP_ICON_CACHE_DIR/.icon.XXXXXX.png")" || return 1
  if ! sips -s format png -z "$APP_ICON_PIXEL_SIZE" "$APP_ICON_PIXEL_SIZE" \
    "$icon_resource" --out "$temporary_path" >/dev/null 2>&1; then
    rm -f "$temporary_path"
    return 1
  fi
  mv -f "$temporary_path" "$cache_path"
  printf '%s\n' "$cache_path"
}

resolve_workspace_app_image() {
  local app_name="$1"
  local bundle_id="${2:-}"
  local icon_resource
  local cached_icon

  if [[ -n "$bundle_id" ]]; then
    if icon_resource="$(find_app_icon_resource "$bundle_id")" \
      && cached_icon="$(cache_app_icon "$bundle_id" "$icon_resource")"; then
      printf '%s\n' "$cached_icon"
    else
      printf 'app.%s\n' "$bundle_id"
    fi
  elif [[ -n "$app_name" ]]; then
    printf 'app.%s\n' "$app_name"
  else
    printf '%s\n' "$GENERIC_APP_ICON"
  fi
}

append_focus_args() {
  local workspace_id="$1"
  local focused_workspace="$2"

  if [[ -n "$focused_workspace" && "$workspace_id" == "$focused_workspace" ]]; then
    SKETCHYBAR_ARGS+=(
      --set "space.$workspace_id.group"
      "background.color=$ACTIVE_COLOR"
      "background.border_color=$ACCENT_COLOR"
      "background.border_width=2"
    )
  else
    SKETCHYBAR_ARGS+=(
      --set "space.$workspace_id.group"
      "background.color=$ITEM_BG_COLOR"
      "background.border_color=$INACTIVE_BORDER_COLOR"
      "background.border_width=1"
    )
  fi
}

append_workspace_render_args() {
  local workspace_id="$1"
  local distinct_apps="$2"
  local slot=1
  local total=0
  local app_record
  local app_name
  local bundle_id
  local image_value
  local overflow_count

  if [[ -z "$distinct_apps" ]]; then
    SKETCHYBAR_ARGS+=(
      --set "space.$workspace_id.group" drawing=on
      --set "space.$workspace_id" drawing=on label.drawing=off label= "width=$EMPTY_WORKSPACE_GROUP_WIDTH"
    )
    for slot in 1 2 3 4; do
      SKETCHYBAR_ARGS+=(--set "space.$workspace_id.app.$slot" drawing=off)
    done
    SKETCHYBAR_ARGS+=(--set "space.$workspace_id.overflow" drawing=off label=)
    return
  fi

  SKETCHYBAR_ARGS+=(
    --set "space.$workspace_id.group" drawing=on
    --set "space.$workspace_id" drawing=on label.drawing=off label= width=0
  )

  while IFS= read -r app_record; do
    [[ -n "$app_record" ]] || continue
    total=$((total + 1))
    if [[ "$slot" -le "$MAX_VISIBLE_WORKSPACE_APPS" ]]; then
      if [[ "$app_record" == *"|"* ]]; then
        app_name="${app_record%%|*}"
        bundle_id="${app_record#*|}"
      else
        app_name="$app_record"
        bundle_id=""
      fi
      image_value="$(resolve_workspace_app_image "$app_name" "$bundle_id")"
      SKETCHYBAR_ARGS+=(
        --set "space.$workspace_id.app.$slot"
        drawing=on
        "background.image=$image_value"
      )
      slot=$((slot + 1))
    fi
  done <<<"$distinct_apps"

  while [[ "$slot" -le "$MAX_VISIBLE_WORKSPACE_APPS" ]]; do
    SKETCHYBAR_ARGS+=(--set "space.$workspace_id.app.$slot" drawing=off)
    slot=$((slot + 1))
  done

  if [[ "$total" -gt "$MAX_VISIBLE_WORKSPACE_APPS" ]]; then
    overflow_count=$((total - MAX_VISIBLE_WORKSPACE_APPS))
    SKETCHYBAR_ARGS+=(--set "space.$workspace_id.overflow" drawing=on "label=+$overflow_count")
  else
    SKETCHYBAR_ARGS+=(--set "space.$workspace_id.overflow" drawing=off label=)
  fi
}

cmd_setup() {
  local focused_workspace
  local generation
  local sid
  local slot
  local click_script
  local anchor
  local refresh_script
  local workspaces=()
  local refresh_cmd=()

  focused_workspace="$(aerospace list-workspaces --focused 2>/dev/null || true)"
  while IFS= read -r sid; do
    [[ -n "$sid" ]] && workspaces+=("$sid")
  done < <(aerospace list-workspaces --all)

  if command -v uuidgen >/dev/null 2>&1; then
    generation="$(uuidgen)"
  else
    generation="gen-$$-$RANDOM"
  fi

  refresh_cmd=("$SCRIPT_PATH" refresh "$generation" "${workspaces[@]}")
  printf -v refresh_script '%q ' "${refresh_cmd[@]}"
  refresh_script="${refresh_script% }"

  SKETCHYBAR_ARGS=(--add event aerospace_workspace_change)

  for sid in "${workspaces[@]}"; do
    anchor="space.$sid"
    click_script="aerospace workspace $sid"

    SKETCHYBAR_ARGS+=(
      --add item "$anchor" left
      --set "$anchor"
      padding_left=0
      padding_right=0
      drawing=on
      background.drawing=off
      icon.drawing=off
      label.drawing=off
      label=
      "width=$EMPTY_WORKSPACE_GROUP_WIDTH"
      "click_script=$click_script"

      --add item "$anchor.pad.left" left
      --set "$anchor.pad.left"
      padding_left=0
      padding_right=0
      "width=$WORKSPACE_GROUP_PADDING_X"
      drawing=on
      icon.drawing=off
      label.drawing=off
      background.drawing=off
      "click_script=$click_script"
    )

    for slot in 1 2 3 4; do
      SKETCHYBAR_ARGS+=(
        --add item "$anchor.app.$slot" left
        --set "$anchor.app.$slot"
        padding_left=0
        padding_right=0
        drawing=off
        icon.drawing=off
        label.drawing=off
        background.drawing=on
        background.color=0x00000000
        background.image.drawing=on
        "background.image.scale=$WORKSPACE_ICON_SCALE"
        "background.image.padding_left=$WORKSPACE_ICON_PADDING_X"
        "background.image.padding_right=$WORKSPACE_ICON_PADDING_X"
        "click_script=$click_script"
      )
    done

    SKETCHYBAR_ARGS+=(
      --add item "$anchor.overflow" left
      --set "$anchor.overflow"
      padding_left=0
      padding_right=0
      drawing=off
      icon.drawing=off
      label.drawing=on
      background.drawing=off
      label.padding_left=2
      label.padding_right=6
      "click_script=$click_script"

      --add item "$anchor.pad.right" left
      --set "$anchor.pad.right"
      padding_left=0
      padding_right=0
      "width=$WORKSPACE_GROUP_PADDING_X"
      drawing=on
      icon.drawing=off
      label.drawing=off
      background.drawing=off
      "click_script=$click_script"

      --add item "$anchor.gap" left
      --set "$anchor.gap"
      padding_left=0
      padding_right=0
      drawing=on
      "width=$WORKSPACE_GROUP_GAP"
      icon=""
      label=""
      icon.drawing=off
      label.drawing=off
      background.drawing=off

      --add bracket "$anchor.group"
      "$anchor"
      "$anchor.pad.left"
      "$anchor.app.1"
      "$anchor.app.2"
      "$anchor.app.3"
      "$anchor.app.4"
      "$anchor.overflow"
      "$anchor.pad.right"
      --set "$anchor.group"
      background.corner_radius=5
      background.drawing=on
      background.height=26
    )

    append_focus_args "$sid" "$focused_workspace"
  done

  # Native window events are hints; the timer catches missed events and moves.
  SKETCHYBAR_ARGS+=(
    --add item space_separator left
    --set space_separator
    icon=""
    icon.padding_left=4
    label.drawing=off
    background.drawing=off
    updates=on
    update_freq=3
    "script=$refresh_script"
    --subscribe space_separator aerospace_workspace_change space_windows_change
  )

  sketchybar "${SKETCHYBAR_ARGS[@]}"

  umask 077
  mkdir -p "$STATE_DIR"
  if [[ -n "$focused_workspace" ]]; then
    printf '%s|%s\n' "$generation" "$focused_workspace" >"$STATE_DIR/workspace-focus"
  else
    rm -f "$STATE_DIR/workspace-focus"
  fi
}

cmd_refresh() {
  local generation="$1"
  shift
  local state_file="$STATE_DIR/workspace-apps"
  local focus_file="$STATE_DIR/workspace-focus"
  local focused_workspace="${FOCUSED_WORKSPACE:-}"
  local previous_focus=""
  local focus_state=""
  local focus_changed=0
  local windows=""
  local windows_ok=0
  local snapshot=""
  local current=""
  local previous=""
  local previous_generation=""
  local apps_changed=0
  local workspace_id
  local apps

  umask 077
  mkdir -p "$STATE_DIR"

  # Events and timer ticks can overlap. Let the next tick catch up rather than
  # allowing two renders (and their cached snapshots) to race.
  exec 9>>"$state_file.lock"
  case "$OSTYPE" in
    darwin*) lockf -s -t 0 9 || exit 0 ;;
    *) flock -n 9 || exit 0 ;; # Linux validation
  esac

  if [[ -z "$focused_workspace" && "${SENDER:-}" == "aerospace_workspace_change" ]]; then
    focused_workspace="$(aerospace list-workspaces --focused 2>/dev/null || true)"
  fi

  SKETCHYBAR_ARGS=()

  if [[ -n "$focused_workspace" ]]; then
    focus_state="$generation|$focused_workspace"
    if [[ -f "$focus_file" ]]; then
      previous_focus="$(<"$focus_file")"
    fi
    if [[ "$previous_focus" != "$focus_state" ]]; then
      focus_changed=1
      for workspace_id; do
        append_focus_args "$workspace_id" "$focused_workspace"
      done
    fi
  fi

  # A failed query is not the same as a successful snapshot with no windows.
  if windows="$(aerospace list-windows --all --format '%{workspace}|%{app-name}|%{app-bundle-id}' 2>/dev/null)"; then
    windows_ok=1
    snapshot="$(workspace_app_snapshot <<<"$windows")"
    current="$generation"
    [[ -z "$snapshot" ]] || current+=$'\n'"$snapshot"

    if [[ -f "$state_file" ]]; then
      previous="$(<"$state_file")"
    fi
    if [[ "$previous" != "$current" ]]; then
      apps_changed=1
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
        append_workspace_render_args "$workspace_id" "$apps"
      done
    fi
  fi

  if [[ "${#SKETCHYBAR_ARGS[@]}" -gt 0 ]]; then
    sketchybar "${SKETCHYBAR_ARGS[@]}"
  fi

  if [[ "$focus_changed" -eq 1 ]]; then
    printf '%s\n' "$focus_state" >"$focus_file.tmp"
    mv -f "$focus_file.tmp" "$focus_file"
  fi

  if [[ "$windows_ok" -eq 1 && "$apps_changed" -eq 1 ]]; then
    printf '%s\n' "$current" >"$state_file.tmp"
    mv -f "$state_file.tmp" "$state_file"
  fi
}

case "${1:-}" in
  setup)
    shift
    cmd_setup "$@"
    ;;
  refresh)
    shift
    cmd_refresh "$@"
    ;;
  *)
    printf 'usage: %s setup | refresh <generation> <workspace...>\n' "$0" >&2
    exit 64
    ;;
esac
