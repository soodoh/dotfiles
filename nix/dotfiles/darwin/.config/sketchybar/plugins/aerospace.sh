#!/bin/sh

source "$CONFIG_DIR/plugins/colors.sh"
workspace_group="$NAME.group"
focused_workspace="${FOCUSED_WORKSPACE:-$(aerospace list-workspaces --focused 2>/dev/null || true)}"

if [ -z "$focused_workspace" ]; then
  exit 0
fi

if [ "$1" = "$focused_workspace" ]; then
  sketchybar --set "$workspace_group" background.color="$ACTIVE_COLOR" background.border_color="$ACCENT_COLOR" background.border_width=2
else
  sketchybar --set "$workspace_group" background.color="$ITEM_BG_COLOR" background.border_color="$INACTIVE_BORDER_COLOR" background.border_width=1
fi
