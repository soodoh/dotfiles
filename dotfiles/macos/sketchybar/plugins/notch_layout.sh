#!/bin/bash

source "$CONFIG_DIR/plugins/bar_sections.sh"

# Shared by sketchybarrc and the display-change handler. Display 0 is a dormant
# association: SketchyBar's real arrangement IDs start at 1 (an empty mask means all).
notch_helper() {
  local source="$CONFIG_DIR/plugins/notch_displays.swift"
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar"
  local binary="$cache/notch-displays"
  mkdir -p "$cache" || return 1
  if [[ ! -x "$binary" || "$source" -nt "$binary" ]]; then
    local temporary
    temporary="$(mktemp "$cache/.notch-displays.XXXXXX")" || return 1
    if ! xcrun swiftc "$source" -o "$temporary"; then
      rm -f "$temporary"
      return 1
    fi
    mv -f "$temporary" "$binary" || return 1
  fi
  "$binary" "$@"
}

notch_display_info() {
  if [[ -n "${NOTCH_DISPLAYS_FILE:-}" ]]; then
    jq . "$NOTCH_DISPLAYS_FILE"
  else
    notch_helper
  fi
}

notch_usage_measurements() {
  if [[ -n "${NOTCH_MEASUREMENTS_FILE:-}" ]]; then
    jq . "$NOTCH_MEASUREMENTS_FILE"
  else
    notch_helper --measure "$1" "$2"
  fi
}

sync_bar_click_guards() {
  local displays="$1" bar="$2" id width guard anchor
  local args=()
  # Arrangement IDs can disappear or be reused after reconnecting a monitor.
  while IFS= read -r guard; do
    id="${guard##*.}"
    if [[ "$guard" == bar.guard ]] || ! jq -e --argjson id "$id" 'any(.[]; .["arrangement-id"] == $id)' <<<"$displays" >/dev/null; then
      args+=(--remove "$guard" --remove "$guard.anchor")
    fi
  done < <(jq -r '.items[] | select(. == "bar.guard" or test("^bar[.]guard[.][0-9]+$"))' <<<"$bar")

  while IFS='|' read -r id width; do
    guard="bar.guard.$id"
    anchor="$guard.anchor"
    if ! jq -e --arg anchor "$anchor" '.items | index($anchor) != null' <<<"$bar" >/dev/null; then
      args+=(--add item "$anchor" left
             --move "$anchor" before bar.guard.padding
             --add bracket "$guard" "$anchor")
    fi
    # Bracket windows are not clipped to displays. Keep each hit region within
    # its own bar; constant zero-width anchors consume no left-side spacing.
    args+=(--set "$anchor" "display=$id" width=0 padding_left=0 "padding_right=$width"
           icon.drawing=off label.drawing=off background.drawing=off
           --set "$guard" "display=$id" background.color=0x00000000 background.drawing=off
           click_script='sketchybar --reorder "$NAME" --set "$NAME" background.drawing=toggle')
  done < <(jq -r '.[] | [.["arrangement-id"], (.frame.w | floor)] | join("|")' <<<"$displays")
  if [[ ${#args[@]} -gt 0 ]]; then
    sketchybar "${args[@]}"
  fi
}

create_bar_click_guard() {
  local bar displays first padding
  bar="$(sketchybar --query bar)" || return 1
  displays="$(sketchybar --query displays)" || return 1
  first="$(jq -r '.items[0]' <<<"$bar")"
  padding="$(jq -r '.padding_left' <<<"$bar")"

  # macOS 27 raises the clicked opaque bar window above its item windows.
  # Transparent brackets catch empty-area clicks and request native restacking.
  # Moving bar padding into one spacer preserves the original left layout.
  sketchybar --bar padding_left=0 \
    --add item bar.guard.padding left \
    --set bar.guard.padding width="$padding" padding_left=0 padding_right=0 \
    icon.drawing=off label.drawing=off background.drawing=off \
    --move bar.guard.padding before "$first" || return 1
  sync_bar_click_guards "$displays" "$bar"
}

notch_popup_row() {
  # Equal name/value columns with matching fonts and symmetric outer gutters.
  sketchybar --set "$1" width=120 padding_left=0 padding_right=0 \
    icon.font="FiraCode Nerd Font:Bold:12.0" icon.width=60 icon.align=left \
    icon.padding_left=12 icon.padding_right=0 \
    label.font="FiraCode Nerd Font:Bold:12.0" label.width=60 label.align=right \
    label.padding_left=0 label.padding_right=12 label.max_chars=0
}

create_notch_items() {
  local item items
  items="$(sketchybar --query bar | jq -r '.items[]')" || return 1
  while IFS= read -r item; do
    # Keep every left-side item exactly as configured, on every display.
    case "$item" in
      clock|right_separator.*|volume|battery|cpu|ram|ai_usage.providers) ;;
      *) continue ;;
    esac
    sketchybar --clone "notch.$item" "$item" \
      --set "notch.$item" display=0 \
      icon.font="FiraCode Nerd Font:Bold:14.0" \
      label.font="FiraCode Nerd Font:Bold:12.0"
  done <<<"$items"

  sketchybar --add item notch.stats right \
    --set notch.stats display=0 icon=󰻠 \
    icon.font="FiraCode Nerd Font:Bold:14.0" \
    script="/bin/sh \"$CONFIG_DIR/plugins/notch_popup.sh\"" \
    popup.align=center popup.height=30 popup.y_offset=-1 \
    popup.background.color="$BAR_COLOR" popup.background.corner_radius=5 \
    popup.background.border_color="$INACTIVE_BORDER_COLOR" popup.background.border_width=1 \
    --subscribe notch.stats mouse.entered mouse.exited mouse.exited.global \
    --move notch.stats after notch.volume

  style_right_sections notch.
  style_bar_section notch.stats icon
  for item in volume battery; do
    sketchybar --set "notch.$item" label.max_chars=4
  done
  sketchybar --set notch.clock label.max_chars=0 \
    --set notch.right_separator.ai drawing=off \
    --set notch.ai_usage.providers position=e padding_left=8 scroll_texts=off label.max_chars=0 label.scroll_duration=100 \
    --set notch.cpu position=popup.notch.stats icon=CPU width=100 \
    --set notch.ram position=popup.notch.stats icon=RAM width=100 \
    --move notch.cpu before notch.ram
  notch_popup_row notch.cpu
  notch_popup_row notch.ram
}

apply_notch_layout() {
  local native displays bar layout
  native="$(notch_display_info)" || return 1
  displays="$(sketchybar --query displays)" || return 1
  bar="$(sketchybar --query bar)" || return 1
  layout="$(jq -n --argjson native "$native" --argjson displays "$displays" --argjson bar "$bar" '
    [$displays[] | . as $display | $native[] |
      select(.id == $display.DirectDisplayID) |
      {id: $display["arrangement-id"], width: $display.frame.w, notch_width: .notch_width}] as $notched |
    {
      notch: ([$notched[].id | tostring] | join(",") | if . == "" then "0" else . end),
      regular: ([$displays[] | select(.["arrangement-id"] as $id |
        $notched | all(.id != $id)) | .["arrangement-id"] | tostring] |
        join(",") | if . == "" then "0" else . end),
      gap: ([$notched[].notch_width + 16 | ceil] | max // 0),
      half: ([$notched[] | ((.width - (.notch_width + 16)) / 2) |
        floor] | min // 0),
      edge: ([$bar.padding_left, $bar.padding_right] | max)
    }')" || return 1

  local notch regular gap half edge
  IFS='|' read -r notch regular gap half edge <<<"$(jq -r '[.notch, .regular, .gap, .half, .edge] | join("|")' <<<"$layout")"

  # Keep sound and battery in the bar. Try full text at 12–9pt before enabling
  # SketchyBar's periodic scroll in a measured, bounded character viewport.
  local available usage_text measurements font_size=12 max_chars=0 scroll=off
  if [[ "$notch" != 0 ]]; then
    usage_text="$(sketchybar --query notch.ai_usage.providers | jq -r 'if .geometry.drawing == "on" then .label.value else "" end')" || return 1
    # Conservative item widths include the shared 6pt gutters: full clock,
    # stats glyph, divider, and two four-character percentages. Also reserve
    # the provider's 8pt notch inset + 12pt label padding and a 12pt item gap.
    available=$(( half - edge - 140 - 24 - 14 - 60 - 60 - 20 - 12 ))
    measurements="$(notch_usage_measurements "$usage_text" "$available")" || return 1
    font_size="$(jq -er --argjson available "$available" '[.[] | select(.width <= $available)] | max_by(.size) | .size // 0' <<<"$measurements")" || return 1
    if [[ "$font_size" == 0 ]]; then
      font_size=9
      max_chars="$(jq -er '.[] | select(.size == 9) | .max_chars | select(. > 0)' <<<"$measurements")" || return 1
      scroll=on
    fi
  fi

  # Native menus must remain mouse-accessible on every display. Let the
  # revealed menu cover the bar; empty-area click restacking uses the guards.
  # Only repair promotion when needed: changing topmost resets all windows.
  local item args=(--bar "notch_width=$gap")
  if [[ "$(jq -r '.topmost' <<<"$bar")" != off ]]; then
    args+=(topmost=off)
  fi
  while IFS= read -r item; do
    case "$item" in
      notch.layout) continue ;;
      notch.*) args+=(--set "$item" "display=$notch") ;;
      clock|right_separator.*|volume|battery|cpu|ram|ai_usage.providers)
        args+=(--set "$item" "display=$regular") ;;
    esac
  done < <(jq -r '.items[]' <<<"$bar")
  sync_bar_click_guards "$displays" "$bar" || return 1
  args+=(--set notch.volume position=right
         --set notch.battery position=right
         --set notch.ai_usage.providers position=e "label.font.size=$font_size"
         "label.max_chars=$max_chars" "scroll_texts=$scroll")
  if [[ "$notch" == 0 ]]; then
    args+=(--set notch.stats popup.drawing=off)
  fi
  sketchybar "${args[@]}"
}
