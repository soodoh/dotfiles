#!/bin/sh

set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)"
sketchybarrc="$repo_root/mac-configs/.config/sketchybar/sketchybarrc"

tmp_dir="$(mktemp -d)"
cleanup() {
  if [ -f "$ai_usage_pid_file" ]; then
    ai_usage_pid="$(cat "$ai_usage_pid_file" 2>/dev/null || true)"
    if [ -n "$ai_usage_pid" ]; then
      kill "$ai_usage_pid" 2>/dev/null || true
    fi
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

config_dir="$tmp_dir/config"
plugin_dir="$config_dir/plugins"
mkdir -p "$plugin_dir"

sketchybar_log="$tmp_dir/sketchybar.log"
aerospace_log="$tmp_dir/aerospace.log"
ai_usage_marker="$tmp_dir/ai_usage_refresh.started"
ai_usage_pid_file="$tmp_dir/ai_usage_refresh.pid"
: >"$sketchybar_log"
: >"$aerospace_log"

cat >"$tmp_dir/sketchybar" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SKETCHYBAR_LOG"
EOF
chmod +x "$tmp_dir/sketchybar"

cat >"$tmp_dir/aerospace" <<'EOF'
#!/bin/sh
printf '%s\n' "aerospace $*" >> "$AEROSPACE_LOG"

case "$1:$2" in
  "list-workspaces:--focused")
    printf '%s\n' "1"
    ;;
  "list-workspaces:--all")
    printf '%s\n' "1"
    ;;
esac
EOF
chmod +x "$tmp_dir/aerospace"

cat >"$plugin_dir/colors.sh" <<'EOF'
#!/bin/sh
export BAR_COLOR=0xff101314
export ITEM_BG_COLOR=0xff353c3f
export ACCENT_COLOR=0xffffffff
export INACTIVE_BORDER_COLOR=0x44ffffff
export DIMMED_COLOR=0x88ffffff
EOF
chmod +x "$plugin_dir/colors.sh"

cat >"$plugin_dir/aerospace_workspace_icons.sh" <<'EOF'
#!/bin/sh
extract_workspace_apps_from_windows() {
  cat
}

create_workspace_icon_items() {
  :
}

create_workspace_group() {
  :
}

render_workspace_items() {
  :
}
EOF
chmod +x "$plugin_dir/aerospace_workspace_icons.sh"

cat >"$plugin_dir/aerospace.sh" <<'EOF'
#!/bin/sh
printf '%s\n' "plugin aerospace.sh $*" >> "$AEROSPACE_LOG"
EOF
chmod +x "$plugin_dir/aerospace.sh"

cat >"$plugin_dir/ai_usage_refresh.sh" <<'EOF'
#!/bin/sh
printf '%s\n' "started" > "$AI_USAGE_MARKER"
printf '%s\n' "$$" > "$AI_USAGE_PID_FILE"
sleep 5
EOF
chmod +x "$plugin_dir/ai_usage_refresh.sh"

assert_call_line_before() {
  first_pattern="$1"
  second_pattern="$2"

  first_line="$(grep -nF -- "$first_pattern" "$sketchybar_log" | head -n 1 | cut -d: -f1 || true)"
  second_line="$(grep -nF -- "$second_pattern" "$sketchybar_log" | head -n 1 | cut -d: -f1 || true)"

  if [ -z "$first_line" ] || [ -z "$second_line" ]; then
    printf 'missing expected sketchybar call(s)\n' >&2
    cat "$sketchybar_log" >&2
    exit 1
  fi

  if [ "$first_line" -ge "$second_line" ]; then
    printf 'expected "%s" before "%s"\n' "$first_pattern" "$second_pattern" >&2
    cat "$sketchybar_log" >&2
    exit 1
  fi
}

start_epoch="$(date +%s)"
PATH="$tmp_dir:$PATH" \
  CONFIG_DIR="$config_dir" \
  SKETCHYBAR_LOG="$sketchybar_log" \
  AEROSPACE_LOG="$aerospace_log" \
  AI_USAGE_MARKER="$ai_usage_marker" \
  AI_USAGE_PID_FILE="$ai_usage_pid_file" \
  sh "$sketchybarrc" >/dev/null 2>&1 &
script_pid=$!

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if ! kill -0 "$script_pid" 2>/dev/null; then
    break
  fi
  sleep 0.05
done

if kill -0 "$script_pid" 2>/dev/null; then
  printf 'sketchybarrc did not exit while ai usage refresh was still blocked\n' >&2
  cat "$sketchybar_log" >&2
  exit 1
fi

end_epoch="$(date +%s)"
elapsed="$((end_epoch - start_epoch))"
if [ "$elapsed" -ge 3 ]; then
  printf 'sketchybarrc took too long: %ss\n' "$elapsed" >&2
  cat "$sketchybar_log" >&2
  exit 1
fi

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if [ -f "$ai_usage_marker" ]; then
    break
  fi
  sleep 0.05
done

if [ ! -f "$ai_usage_marker" ]; then
  printf 'expected ai usage refresh to start asynchronously\n' >&2
  cat "$sketchybar_log" >&2
  exit 1
fi

assert_call_line_before '--update' '--add item ai_usage.refresh right'
