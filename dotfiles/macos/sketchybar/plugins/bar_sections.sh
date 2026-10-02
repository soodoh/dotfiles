#!/bin/bash

# Keep gutters inside the item window: icon-only buttons retain a useful hover
# target, and variable-length percentages don't leave fixed-width dead space.
style_bar_section() {
  local item="$1" kind="${2:-metric}" padding=6
  local args=(--set "$item" width=dynamic padding_left=0 padding_right=0
    icon.width=dynamic icon.align=left icon.padding_left="$padding" icon.padding_right=4
    label.width=dynamic label.align=left label.padding_left=0 label.padding_right="$padding"
    icon.drawing=on label.drawing=on)
  case "$kind" in
    text) args+=(icon.drawing=off "label.padding_left=$padding") ;;
    icon) args+=(label.drawing=off "icon.padding_right=$padding") ;;
  esac
  sketchybar "${args[@]}"
}

style_right_sections() {
  local prefix="${1:-}" item
  for item in volume battery cpu ram; do
    style_bar_section "$prefix$item"
  done
  for item in clock ai_usage.providers; do
    style_bar_section "$prefix$item" text
  done
  for item in right_separator.system right_separator.ai; do
    style_bar_section "$prefix$item" icon
  done
}
