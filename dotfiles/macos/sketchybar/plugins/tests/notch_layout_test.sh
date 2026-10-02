#!/bin/bash
set -euo pipefail

# Protect monitor-ID mapping, the unchanged left layout, and overflow/recovery.
plugin_dir="$(cd "$(dirname "$0")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat >"$tmp_dir/sketchybar" <<'EOF'
#!/bin/bash
if [[ "$1" == --query ]]; then
  case "$2" in
    bar) printf '%s\n' "$BAR_JSON" ;;
    displays) printf '%s\n' "$DISPLAYS_JSON" ;;
    notch.ai_usage.providers) printf '%s\n' '{"geometry":{"drawing":"on"},"label":{"value":"Provider usage"}}' ;;
  esac
else
  printf '%s\n' "$@" | jq -Rs 'split("\n")[:-1]' >>"$SKETCHYBAR_LOG"
fi
EOF
chmod +x "$tmp_dir/sketchybar"
export PATH="$tmp_dir:$PATH"
export CONFIG_DIR="$plugin_dir/.."
export SKETCHYBAR_LOG="$tmp_dir/log.jsonl"
export NOTCH_DISPLAYS_FILE="$tmp_dir/native.json"
export NOTCH_MEASUREMENTS_FILE="$tmp_dir/measurements.json"
printf '%s\n' '[{"size":12,"width":260},{"size":11,"width":240},{"size":10,"width":220},{"size":9,"width":200,"max_chars":24}]' >"$NOTCH_MEASUREMENTS_FILE"
export BAR_JSON='{"topmost":"off","padding_left":20,"padding_right":20,"items":["space.1","space.1.app.1","space.1.group","front_app","clock","ai_usage.providers","right_separator.ai","ai_usage.refresh","notch.clock","notch.ai_usage.providers","notch.stats","notch.layout"]}'
source "$plugin_dir/notch_layout.sh"
source "$plugin_dir/colors.sh"

properties() {
  jq -s '
    reduce .[][] as $arg ({items:{}, command:null, item:null};
      if ($arg | startswith("--")) then .command=$arg | .item=null
      elif .command == "--set" and .item == null then .item=$arg
      elif .command == "--set" then
        ($arg | split("=")) as $kv | .items[.item][$kv[0]]=($kv[1:] | join("="))
      else . end) | .items
  ' "$SKETCHYBAR_LOG"
}
assert() {
  properties | jq -e "$1" >/dev/null || { printf 'failed: %s\n' "$1" >&2; exit 1; }
}
run_layout() {
  : >"$SKETCHYBAR_LOG"
  apply_notch_layout
  # Guard properties in this command log represent the connected displays.
  # Keep the query snapshot current so reconnects exercise creation/reuse.
  BAR_JSON="$(properties | jq --argjson bar "$BAR_JSON" '
    . as $items | $bar | .items = (
      [.items[] | select(. == "bar.guard.padding" or (startswith("bar.guard") | not))] +
      ($items | keys | map(select(startswith("bar.guard.") and . != "bar.guard.padding")))
    )
  ')"
}

# Pin the actual clock plugin output: its final time digit must never be clipped.
cat >"$tmp_dir/date" <<'EOF'
#!/bin/sh
printf '%s\n' 'Mon 12/31 23:59'
EOF
chmod +x "$tmp_dir/date"
: >"$SKETCHYBAR_LOG"
style_right_sections
create_notch_items
# Common and notched layouts share content gutters; every status item sizes to
# its contents so percentages of different lengths do not create unequal gaps.
assert '. as $items | ["clock", "volume", "battery", "cpu", "ram", "notch.clock", "notch.volume", "notch.battery", "notch.stats"] | all(. as $name | $items[$name].width == "dynamic" and $items[$name].padding_left == "0" and $items[$name].padding_right == "0")'
assert '. as $items | ["volume", "battery", "cpu", "ram", "notch.volume", "notch.battery"] | all(. as $name | $items[$name]["icon.padding_left"] == $items.clock["label.padding_left"] and $items[$name]["label.padding_right"] == $items.clock["label.padding_right"])'
assert '."notch.stats"["icon.padding_left"] == .clock["label.padding_left"] and ."notch.stats"["icon.padding_right"] == .clock["label.padding_right"]'
assert '.clock["icon.drawing"] == "off" and ."notch.clock"["icon.drawing"] == "off"'
NAME=notch.clock bash "$plugin_dir/clock.sh"
properties | jq -e '
  ."notch.clock" as $clock |
  ($clock["label.max_chars"] | tonumber) as $cap |
  $cap == 0 or ($clock.label | length) <= $cap
' >/dev/null || { printf 'clock character limit clips the formatted time\n' >&2; exit 1; }
assert '."notch.ai_usage.providers"."label.max_chars" == "0" and ."notch.ai_usage.providers".scroll_texts == "off"'
assert '."notch.cpu".position == "popup.notch.stats" and ."notch.ram".position == "popup.notch.stats"'
assert '."notch.stats"."popup.align" == "center"'
# Columns share typography and exactly fill the row; the value is right-aligned.
assert '."notch.cpu" as $row | $row["icon.font"] == $row["label.font"] and $row["icon.align"] == "left" and $row["label.align"] == "right" and (($row["icon.width"]|tonumber) + ($row["label.width"]|tonumber)) == ($row.width|tonumber)'
# Equal glyph gutters, not fixed-width whitespace, keep the icon button centered.
assert '."notch.stats" as $button | $button["icon.padding_left"] == $button["icon.padding_right"] and $button.width == "dynamic"'
assert '."notch.clock"."icon.drawing" == "off"'
assert '."notch.clock".width == "dynamic"'
# Preserving the left side means not cloning or changing its display/geometry.
assert '.front_app == null and ."space.1" == null and ."space.1.app.1" == null'

# Exercise the configured hover script. Entering opens it idempotently; clicks
# and routine updates do nothing, and exiting cannot leave the popup pinned.
popup_script="$(properties | jq -r '."notch.stats".script')"
: >"$SKETCHYBAR_LOG"
NAME=notch.stats SENDER=mouse.entered /bin/sh -c "$popup_script"
assert '."notch.stats"."popup.drawing" == "on"'
[[ "$(wc -l <"$SKETCHYBAR_LOG" | tr -d ' ')" == 1 ]]
: >"$SKETCHYBAR_LOG"
NAME=notch.stats SENDER=forced /bin/sh -c "$popup_script"
NAME=notch.stats SENDER=routine /bin/sh -c "$popup_script"
NAME=notch.stats SENDER=mouse.clicked BUTTON=left /bin/sh -c "$popup_script"
NAME=notch.stats SENDER=mouse.clicked BUTTON=right /bin/sh -c "$popup_script"
[[ ! -s "$SKETCHYBAR_LOG" ]]
NAME=notch.stats SENDER=mouse.exited /bin/sh -c "$popup_script"
assert '."notch.stats"."popup.drawing" == "off"'
: >"$SKETCHYBAR_LOG"
NAME=notch.stats SENDER=mouse.exited.global /bin/sh -c "$popup_script"
assert '."notch.stats"."popup.drawing" == "off"'

printf '%s\n' '[{"id":73,"width":1512,"notch_width":185}]' >"$NOTCH_DISPLAYS_FILE"
export DISPLAYS_JSON='[{"arrangement-id":1,"DirectDisplayID":99,"frame":{"x":1512,"y":-200,"w":2560}},{"arrangement-id":2,"DirectDisplayID":73,"frame":{"x":0,"y":0,"w":1512}},{"arrangement-id":3,"DirectDisplayID":101,"frame":{"x":-1920,"y":0,"w":1920}}]'
: >"$SKETCHYBAR_LOG"
create_bar_click_guard
# Each hit region covers only its own bar, never an adjacent monitor's apps.
assert_guards() {
  properties | jq -e --argjson displays "$DISPLAYS_JSON" '
    . as $items | $displays | all(
      (.["arrangement-id"] | tostring) as $id |
      $items["bar.guard." + $id + ".anchor"] as $anchor |
      $items["bar.guard." + $id] as $guard |
      $guard.display == $id and $anchor.display == $id and
      $anchor.width == "0" and $anchor.padding_left == "0" and
      ($anchor.padding_right | tonumber) == (.frame.w | floor)
    )
  ' >/dev/null || { printf 'guard hit region escapes its display\n' >&2; exit 1; }
}
assert_guards
# Moving original bar padding into an invisible spacer preserves left positions.
properties | jq -e --argjson bar "$BAR_JSON" '."bar.guard.padding".width | tonumber == $bar.padding_left' >/dev/null
# Emulate the next native bar snapshot after adding the guard items.
BAR_JSON="$(properties | jq --argjson bar "$BAR_JSON" '. as $items | $bar | .padding_left=0 | .items += ($items | keys | map(select(startswith("bar.guard."))))')"
guard_click="$(properties | jq -r '."bar.guard.2".click_script')"
: >"$SKETCHYBAR_LOG"
NAME=bar.guard.2 /bin/sh -c "$guard_click"
assert '."bar.guard.2"."background.drawing" == "toggle"'
jq -es '[.[][]] | index("--reorder") != null' "$SKETCHYBAR_LOG" >/dev/null

# A hot-reloaded handler also retires the previous all-display guard.
BAR_JSON="$(jq '.items += ["bar.guard", "bar.guard.anchor"]' <<<"$BAR_JSON")"
run_layout
jq -es '. | any(. as $args | range(0; length) as $i | $args[$i] == "--remove" and $args[$i + 1] == "bar.guard")' "$SKETCHYBAR_LOG" >/dev/null
assert '.clock == {display:"1,3"} and ."notch.clock".display == "2"'
assert '.front_app == null and ."space.1.group" == null and ."space.1.app.1" == null'
# A notched display must not promote any bar above native menu headers.
jq -es '[.[][]] | all(. != "topmost=on")' "$SKETCHYBAR_LOG" >/dev/null
assert_guards
jq -es '[.[][]] | all(. != "--add")' "$SKETCHYBAR_LOG" >/dev/null
assert '."notch.ai_usage.providers".position == "e" and ."notch.ai_usage.providers"."label.font.size" == "12" and ."notch.ai_usage.providers".scroll_texts == "off" and ."notch.ai_usage.providers"["label.max_chars"] == "0" and ."notch.volume".position == "right" and ."notch.battery".position == "right"'

# Reflow also repairs promotion left by the previous config, then leaves
# layering alone while the popup is in use (topmost changes reset windows).
BAR_JSON="$(jq '.topmost="on"' <<<"$BAR_JSON")"
run_layout
jq -es '[.[][]] | index("topmost=off") != null' "$SKETCHYBAR_LOG" >/dev/null
BAR_JSON="$(jq '.topmost="off"' <<<"$BAR_JSON")"
run_layout
jq -es '[.[][]] | all(startswith("topmost=") | not)' "$SKETCHYBAR_LOG" >/dev/null

# Choose the largest font that fits, without moving either status indicator.
export DISPLAYS_JSON='[{"arrangement-id":1,"DirectDisplayID":73,"frame":{"w":1360.5}}]'
run_layout
assert_guards
# Disconnect/rearrange removes stale hit regions, not just their associations.
jq -es '[.[][]] | index("--remove") != null and index("bar.guard.2") != null and index("bar.guard.3") != null' "$SKETCHYBAR_LOG" >/dev/null
assert '."notch.ai_usage.providers"["label.font.size"] == "10" and ."notch.ai_usage.providers".scroll_texts == "off"'
assert '."notch.volume".position == "right" and ."notch.battery".position == "right"'
export DISPLAYS_JSON='[{"arrangement-id":1,"DirectDisplayID":73,"frame":{"w":1320}}]'
run_layout
assert '."notch.ai_usage.providers"["label.font.size"] == "9" and ."notch.ai_usage.providers".scroll_texts == "off" and ."notch.ai_usage.providers"["label.max_chars"] == "0"'

# Only overflowing even at 9pt starts periodic scrolling with the measured cap.
export DISPLAYS_JSON='[{"arrangement-id":1,"DirectDisplayID":73,"frame":{"w":1280}}]'
run_layout
assert '."notch.ai_usage.providers".position == "e" and ."notch.ai_usage.providers"["label.font.size"] == "9" and ."notch.ai_usage.providers".scroll_texts == "on" and ."notch.ai_usage.providers"["label.max_chars"] == "24"'
assert '."notch.volume".position == "right" and ."notch.battery".position == "right"'

# A shorter usage update stops scrolling and clears the cap at the same width.
printf '%s\n' '[{"size":12,"width":150},{"size":11,"width":138},{"size":10,"width":126},{"size":9,"width":114,"max_chars":0}]' >"$NOTCH_MEASUREMENTS_FILE"
run_layout
assert '."notch.ai_usage.providers"["label.font.size"] == "12" and ."notch.ai_usage.providers".scroll_texts == "off" and ."notch.ai_usage.providers"["label.max_chars"] == "0"'

printf '%s\n' '[{"size":12,"width":260}]' >"$NOTCH_MEASUREMENTS_FILE"
export DISPLAYS_JSON='[{"arrangement-id":1,"DirectDisplayID":73,"frame":{"w":1512}}]'
run_layout
assert '.clock.display == "0" and ."notch.clock".display == "1" and .front_app == null'
# Widening the display also restores full, unbounded provider text.
assert '."notch.ai_usage.providers"["label.font.size"] == "12" and ."notch.ai_usage.providers".scroll_texts == "off" and ."notch.ai_usage.providers"["label.max_chars"] == "0"'

# Clamshell also clears a previous scrolling state on the dormant notch item.
printf '%s\n' '[{"size":12,"width":999},{"size":9,"width":750,"max_chars":24}]' >"$NOTCH_MEASUREMENTS_FILE"
run_layout
assert '."notch.ai_usage.providers".scroll_texts == "on"'
# Restore external layout and original layering, closing hidden popups.
printf '%s\n' '[]' >"$NOTCH_DISPLAYS_FILE"
export DISPLAYS_JSON='[{"arrangement-id":1,"DirectDisplayID":99,"frame":{"w":2560}}]'
run_layout
assert '.clock.display == "1" and ."notch.clock".display == "0" and .front_app == null and ."notch.stats"."popup.drawing" == "off"'
assert '."notch.ai_usage.providers".scroll_texts == "off" and ."notch.ai_usage.providers"["label.max_chars"] == "0"'
jq -es '[.[][]] | all(. != "topmost=on")' "$SKETCHYBAR_LOG" >/dev/null
assert_guards

# Reconnect with a new arrangement ID: create only the newly needed guard.
export DISPLAYS_JSON='[{"arrangement-id":4,"DirectDisplayID":99,"frame":{"w":1920}}]'
run_layout
assert_guards
jq -es '. | any(. as $args | range(0; length) as $i | $args[$i] == "--add" and $args[$i + 2] == "bar.guard.4.anchor")' "$SKETCHYBAR_LOG" >/dev/null
run_layout
assert_guards
jq -es '[.[][]] | all(. != "--add" and . != "--remove")' "$SKETCHYBAR_LOG" >/dev/null

# Detection failure must not rewrite associations or masquerade as clamshell.
printf '%s\n' 'invalid JSON' >"$NOTCH_DISPLAYS_FILE"
: >"$SKETCHYBAR_LOG"
if apply_notch_layout 2>/dev/null; then
  printf 'invalid detector output unexpectedly succeeded\n' >&2
  exit 1
fi
[[ ! -s "$SKETCHYBAR_LOG" ]]
