#!/bin/bash

# Right items render from right to left. This is the single layout declaration:
# name:kind[:notch placement]. Omitted placement stays in the notch's right row;
# popup metrics share the stats button, e sits beside the notch, hidden is omitted.
RIGHT_SECTIONS=(
  clock:text
  right_separator.system:separator
  battery:metric
  volume:metric
  ram:metric:popup
  cpu:metric:popup
  right_separator.ai:separator:hidden
  ai_usage.providers:text:e
)

# Shared by the bar and its edge-to-edge separators.
BAR_ROW_HEIGHT=32
BAR_SECTION_GUTTER=6
BAR_METRIC_GAP=4
BAR_SEPARATOR_WIDTH=1
BAR_SEPARATOR_GUTTER=10
BAR_NOTCH_INSET=8

# Gutters belong to each item, never its neighbours. Dynamic content widths
# keep the same gap for 1%, 99%, and 100%, including after hiding/reordering items.
# Keep button gutters inside their window so the whole button remains hoverable.
style_bar_section() {
  local item="$1" kind="${2:-metric}" icon_width=dynamic outer=0
  if [[ "$kind" == separator ]]; then
    icon_width="$BAR_SEPARATOR_WIDTH"
    outer="$BAR_SEPARATOR_GUTTER"
  fi
  local args=(--set "$item" width=dynamic "padding_left=$outer" "padding_right=$outer"
    "icon.width=$icon_width" icon.align=left icon.padding_left="$BAR_SECTION_GUTTER" icon.padding_right="$BAR_METRIC_GAP"
    label.width=dynamic label.align=left label.padding_left=0 label.padding_right="$BAR_SECTION_GUTTER"
    icon.drawing=on label.drawing=on label.max_chars=0 background.drawing=off)
  case "$kind" in
    text) args+=(icon.drawing=off "label.padding_left=$BAR_SECTION_GUTTER") ;;
    icon) args+=(label.drawing=off "icon.padding_right=$BAR_SECTION_GUTTER") ;;
    separator)
      # A glyph such as │ has a font-dependent side bearing: equal padding
      # around its text box does not give equal visible gaps around the line.
      # An empty fixed-width icon gives the dynamic item its line width.
      # Fixed *item* widths bypass outer padding in SketchyBar's RTL layout.
      args+=(icon= icon.padding_left=0 icon.padding_right=0 label.drawing=off background.drawing=on
        background.color=0x66ffffff "background.height=$BAR_ROW_HEIGHT" background.corner_radius=0
        background.border_width=0)
      ;;
  esac
  sketchybar "${args[@]}"
}

create_right_sections() {
  local section item kind placement args
  for section in "${RIGHT_SECTIONS[@]}"; do
    IFS=: read -r item kind placement <<<"$section"
    args=(--add item "$item" right)
    case "$kind" in
      metric|text) args+=(--set "$item" "script=$PLUGIN_DIR/$item.sh" update_freq=120) ;;
    esac
    case "$item" in
      clock) args+=(--set "$item" update_freq=10) ;;
      cpu) args+=(--set "$item" update_freq=10 icon=󰻠) ;;
      battery) args+=(--subscribe "$item" system_woke power_source_change) ;;
      volume) args+=(--set "$item" update_freq=0 --subscribe "$item" volume_change) ;;
      ram) args+=(--set "$item" icon=) ;;
      ai_usage.providers) args+=(--set "$item" script= update_freq=0 drawing=off) ;;
      right_separator.ai) args+=(--set "$item" drawing=off) ;;
    esac
    sketchybar "${args[@]}"
    style_bar_section "$item" "$kind"
  done
}

# Conservative content bounds at the notch fonts, plus the actual shared
# gutters. Count the declared row, not a second list of clock/sound/battery/etc.
notch_right_sections_width() {
  local section item kind placement width=0 has_popup=0 content gutter
  for section in "${RIGHT_SECTIONS[@]}"; do
    IFS=: read -r item kind placement <<<"$section"
    case "$placement" in
      popup) has_popup=1; continue ;;
      hidden|e) continue ;;
    esac
    gutter="$BAR_SECTION_GUTTER"
    case "$kind" in
      metric) content=$((44 + BAR_METRIC_GAP)) ;;
      text) content=128 ;;
      icon) content=12 ;;
      separator) content="$BAR_SEPARATOR_WIDTH"; gutter="$BAR_SEPARATOR_GUTTER" ;;
    esac
    width=$((width + content + 2 * gutter))
  done
  # Multiple popup rows consume only one icon button in the bar.
  printf '%s\n' "$((width + has_popup * (12 + 2 * BAR_SECTION_GUTTER)))"
}
