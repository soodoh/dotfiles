#!/bin/bash
set -euo pipefail

MAX_VISIBLE_WORKSPACE_APPS="${MAX_VISIBLE_WORKSPACE_APPS:-4}"
GENERIC_APP_ICON="${GENERIC_APP_ICON:-/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns}"
WORKSPACE_GROUP_GAP="${WORKSPACE_GROUP_GAP:-8}"
WORKSPACE_GROUP_PADDING_X="${WORKSPACE_GROUP_PADDING_X:-8}"
EMPTY_WORKSPACE_GROUP_WIDTH="${EMPTY_WORKSPACE_GROUP_WIDTH:-12}"
WORKSPACE_ICON_PADDING_X="${WORKSPACE_ICON_PADDING_X:-1}"
WORKSPACE_ICON_SCALE="${WORKSPACE_ICON_SCALE:-0.65}"

extract_workspace_apps_from_windows() {
	awk -F'|' '
		function trim(value) {
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			return value
		}
		{
			app_name = trim($2)
			bundle_id = trim($3)
			if (app_name != "" || bundle_id != "") {
				print app_name "|" bundle_id
			}
		}
	'
}

ordered_distinct_apps() {
	awk -F'|' '
		function trim(value) {
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			return value
		}
		NF {
			app_name = trim($1)
			bundle_id = trim($2)
			identity = bundle_id != "" ? bundle_id : app_name
			if (identity != "" && !seen[identity]++) {
				print app_name "|" bundle_id
			}
		}
	'
}

parse_workspace_app_record() {
	local record="$1"

	WORKSPACE_APP_RECORD_NAME=""
	WORKSPACE_APP_RECORD_BUNDLE_ID=""

	if [[ "$record" == *"|"* ]]; then
		WORKSPACE_APP_RECORD_NAME="${record%%|*}"
		WORKSPACE_APP_RECORD_BUNDLE_ID="${record#*|}"
	else
		WORKSPACE_APP_RECORD_NAME="$record"
	fi
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
	local bundle_id="${2:-}"

	if [[ -n "$bundle_id" ]]; then
		printf 'app.%s\n' "$bundle_id"
	elif [[ -n "$app_name" ]]; then
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
	local distinct_apps
	local overflow_count
	local slot=1
	local app_record
	local app_name
	local bundle_id
	local image_value

	distinct_apps="$(printf '%s' "$raw_apps" | ordered_distinct_apps)"

	if [[ -z "$distinct_apps" ]]; then
		sketchybar --set "space.$workspace_id.group" drawing=on
		sketchybar --set "space.$workspace_id" drawing=on label.drawing=off label=
		sketchybar --set "space.$workspace_id" width="$EMPTY_WORKSPACE_GROUP_WIDTH"
		hide_workspace_icon_items "$workspace_id"
		return
	fi

	sketchybar --set "space.$workspace_id.group" drawing=on
	sketchybar --set "space.$workspace_id" drawing=on label.drawing=off label=
	sketchybar --set "space.$workspace_id" width=0

	while IFS= read -r app_record; do
		[[ -z "$app_record" ]] && continue
		parse_workspace_app_record "$app_record"
		app_name="$WORKSPACE_APP_RECORD_NAME"
		bundle_id="$WORKSPACE_APP_RECORD_BUNDLE_ID"
		image_value="$(resolve_workspace_app_image "$app_name" "$bundle_id")"
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
