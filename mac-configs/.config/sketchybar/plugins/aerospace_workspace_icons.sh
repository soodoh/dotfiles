#!/bin/bash
set -euo pipefail

MAX_VISIBLE_WORKSPACE_APPS="${MAX_VISIBLE_WORKSPACE_APPS:-4}"
GENERIC_APP_ICON="${GENERIC_APP_ICON:-/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns}"
WORKSPACE_GROUP_GAP="${WORKSPACE_GROUP_GAP:-8}"
WORKSPACE_GROUP_PADDING_X="${WORKSPACE_GROUP_PADDING_X:-8}"
WORKSPACE_ICON_PADDING_X="${WORKSPACE_ICON_PADDING_X:-1}"
WORKSPACE_ICON_SCALE="${WORKSPACE_ICON_SCALE:-0.65}"

extract_workspace_apps_from_windows() {
  awk -F'|' '{gsub(/^ *| *$/, "", $2); if ($2 != "") print $2}'
}

ordered_distinct_apps() {
  awk '
    NF && !seen[$0]++ {
      print
    }
  '
}

visible_workspace_apps() {
  local max_visible="${1:-$MAX_VISIBLE_WORKSPACE_APPS}"
  awk -v max_visible="$max_visible" 'NF && NR <= max_visible { print }'
}

workspace_overflow_count() {
  local max_visible="${1:-$MAX_VISIBLE_WORKSPACE_APPS}"
  awk -v max_visible="$max_visible" '
    NF { count++ }
    END {
      if (count > max_visible) {
        print count - max_visible
      } else {
        print 0
      }
    }
  '
}

resolve_workspace_app_image() {
  local app_name="$1"
  local escaped_app_name
  local spotlight_query
  local bundle_path

  if [[ -z "$app_name" ]]; then
    printf '%s\n' "$GENERIC_APP_ICON"
    return
  fi

  escaped_app_name="${app_name//\\/\\\\}"
  escaped_app_name="${escaped_app_name//\"/\\\"}"
  spotlight_query="kMDItemContentTypeTree == \"com.apple.application-bundle\" && (kMDItemFSName == \"$escaped_app_name.app\" || kMDItemDisplayName == \"$escaped_app_name\")"

  bundle_path="$(mdfind "$spotlight_query" | head -n 1)"
  if [[ -n "$bundle_path" ]]; then
    printf 'app.%s\n' "$app_name"
  else
    printf '%s\n' "$GENERIC_APP_ICON"
  fi
}

create_workspace_group() {
  local workspace_id="$1"
  local anchor="space.$workspace_id"

  sketchybar --add bracket "$anchor.group" \
    "$anchor" \
    "$anchor.pad.left" \
    "$anchor.app.1" \
    "$anchor.app.2" \
    "$anchor.app.3" \
    "$anchor.app.4" \
    "$anchor.overflow" \
    "$anchor.pad.right"
}

create_workspace_icon_items() {
  local workspace_id="$1"
  local anchor="space.$workspace_id"
  local previous_item="$anchor.pad.left"
  local click_script="aerospace workspace $workspace_id"
  local slot

  sketchybar --add item "$anchor.pad.left" left \
    --set "$anchor.pad.left" \
    padding_left=0 \
    padding_right=0 \
    width="$WORKSPACE_GROUP_PADDING_X" \
    drawing=on \
    icon.drawing=off \
    label.drawing=off \
    background.drawing=off \
    click_script="$click_script"
  sketchybar --move "$anchor.pad.left" after "$anchor"

  for slot in 1 2 3 4; do
    sketchybar --add item "$anchor.app.$slot" left \
      --set "$anchor.app.$slot" \
      padding_left=0 \
      padding_right=0 \
      drawing=off \
      icon.drawing=off \
      label.drawing=off \
      background.drawing=on \
      background.color=0x00000000 \
      background.image.drawing=on \
      background.image.scale="$WORKSPACE_ICON_SCALE" \
      background.image.padding_left="$WORKSPACE_ICON_PADDING_X" \
      background.image.padding_right="$WORKSPACE_ICON_PADDING_X" \
      click_script="$click_script"
    sketchybar --move "$anchor.app.$slot" after "$previous_item"
    previous_item="$anchor.app.$slot"
  done

  sketchybar --add item "$anchor.overflow" left \
    --set "$anchor.overflow" \
    padding_left=0 \
    padding_right=0 \
    drawing=off \
    icon.drawing=off \
    label.drawing=on \
    background.drawing=off \
    label.padding_left=2 \
    label.padding_right=6 \
    click_script="$click_script"
  sketchybar --move "$anchor.overflow" after "$previous_item"
  previous_item="$anchor.overflow"

  sketchybar --add item "$anchor.pad.right" left \
    --set "$anchor.pad.right" \
    padding_left=0 \
    padding_right=0 \
    width="$WORKSPACE_GROUP_PADDING_X" \
    drawing=on \
    icon.drawing=off \
    label.drawing=off \
    background.drawing=off \
    click_script="$click_script"
  sketchybar --move "$anchor.pad.right" after "$previous_item"
  previous_item="$anchor.pad.right"

  sketchybar --add item "$anchor.gap" left \
    --set "$anchor.gap" \
    padding_left=0 \
    padding_right=0 \
    drawing=on \
    width="$WORKSPACE_GROUP_GAP" \
    icon="" \
    label="" \
    icon.drawing=off \
    label.drawing=off \
    background.drawing=off
  sketchybar --move "$anchor.gap" after "$previous_item"
}

hide_workspace_icon_items() {
  local workspace_id="$1"
  local slot

  for slot in 1 2 3 4; do
    sketchybar --set "space.$workspace_id.app.$slot" drawing=off
  done

  sketchybar --set "space.$workspace_id.overflow" drawing=off label=
}

render_workspace_items() {
  local workspace_id="$1"
  local raw_apps="${2:-}"
  local keep_visible_when_empty="${3:-false}"
  local distinct_apps
  local overflow_count
  local slot=1
  local app_name
  local image_value

  distinct_apps="$(printf '%s' "$raw_apps" | ordered_distinct_apps)"

  if [[ -z "$distinct_apps" ]]; then
    if [[ "$keep_visible_when_empty" == "true" ]]; then
      sketchybar --set "space.$workspace_id.group" drawing=on
      sketchybar --set "space.$workspace_id" drawing=on label.drawing=off label=
    else
      sketchybar --set "space.$workspace_id.group" drawing=off
      sketchybar --set "space.$workspace_id" drawing=off label.drawing=off label=
    fi
    hide_workspace_icon_items "$workspace_id"
    return
  fi

  sketchybar --set "space.$workspace_id.group" drawing=on
  sketchybar --set "space.$workspace_id" drawing=on label.drawing=off label=

  while IFS= read -r app_name; do
    [[ -z "$app_name" ]] && continue
    image_value="$(resolve_workspace_app_image "$app_name")"
    sketchybar --set "space.$workspace_id.app.$slot" drawing=on background.image="$image_value"
    slot=$((slot + 1))
    if [[ "$slot" -gt "$MAX_VISIBLE_WORKSPACE_APPS" ]]; then
      break
    fi
  done < <(printf '%s\n' "$distinct_apps" | visible_workspace_apps "$MAX_VISIBLE_WORKSPACE_APPS")

  while [[ "$slot" -le "$MAX_VISIBLE_WORKSPACE_APPS" ]]; do
    sketchybar --set "space.$workspace_id.app.$slot" drawing=off
    slot=$((slot + 1))
  done

  overflow_count="$(printf '%s\n' "$distinct_apps" | workspace_overflow_count "$MAX_VISIBLE_WORKSPACE_APPS")"
  if [[ "$overflow_count" -gt 0 ]]; then
    sketchybar --set "space.$workspace_id.overflow" drawing=on label="+$overflow_count"
  else
    sketchybar --set "space.$workspace_id.overflow" drawing=off label=
  fi
}
