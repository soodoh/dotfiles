#!/bin/bash
set -euo pipefail

plugin_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
plugin_path="$plugin_dir/aerospace_workspaces.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

export PATH="$tmp_dir:$PATH"
export XDG_CACHE_HOME="$tmp_dir/cache"
export WINDOWS="$tmp_dir/windows"
export WORKSPACES="$tmp_dir/workspaces"
export FOCUSED_FILE="$tmp_dir/focused"
export QUERY_LOG="$tmp_dir/aerospace.log"
export BAR_LOG="$tmp_dir/bar.log"
export BAR_CALL_COUNT="$tmp_dir/bar.count"
export FAKE_APP_BUNDLE="$tmp_dir/Slack.app"

mkdir -p "$FAKE_APP_BUNDLE/Contents/Resources"
: >"$FAKE_APP_BUNDLE/Contents/Info.plist"
: >"$FAKE_APP_BUNDLE/Contents/Resources/Slack.icns"

cat >"$tmp_dir/aerospace" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$QUERY_LOG"
case "$1 $2" in
  "list-workspaces --all")
    cat "$WORKSPACES"
    ;;
  "list-workspaces --focused")
    cat "$FOCUSED_FILE"
    ;;
  "list-windows --all")
    [ "${QUERY_FAIL:-0}" = 0 ] || exit 1
    cat "$WINDOWS"
    ;;
  *)
    exit 1
    ;;
esac
EOF

# Record each SketchyBar invocation on its own line AND record individual
# "--set ..." / "--add ..." segments so tests assert both batching and exact args.
cat >"$tmp_dir/sketchybar" <<'EOF'
#!/bin/sh
printf '1\n' >> "$BAR_CALL_COUNT"
current=""
for arg in "$@"; do
  case "$arg" in
    --add|--set|--subscribe)
      if [ -n "$current" ]; then
        printf '%s\n' "$current" >> "$BAR_LOG"
      fi
      current="$arg"
      ;;
    *)
      current="$current $arg"
      ;;
  esac
done
if [ -n "$current" ]; then
  printf '%s\n' "$current" >> "$BAR_LOG"
fi
EOF

cat >"$tmp_dir/mdfind" <<'EOF'
#!/bin/sh
case "$*" in
  *com.tinyspeck.slackmacgap*) printf '%s\n' "$FAKE_APP_BUNDLE" ;;
esac
EOF

cat >"$tmp_dir/PlistBuddy" <<'EOF'
#!/bin/sh
printf '%s\n' 'Slack.icns'
EOF

cat >"$tmp_dir/sips" <<'EOF'
#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--out" ]; then
    shift
    : >"$1"
    exit 0
  fi
  shift
done
exit 1
EOF

chmod +x "$tmp_dir/aerospace" "$tmp_dir/sketchybar" "$tmp_dir/mdfind" "$tmp_dir/PlistBuddy" "$tmp_dir/sips"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  printf 'AeroSpace calls:\n' >&2
  cat "$QUERY_LOG" >&2 || true
  printf 'SketchyBar invocations: %s\n' "$(wc -l <"$BAR_CALL_COUNT" 2>/dev/null || echo 0)" >&2
  printf 'SketchyBar commands:\n' >&2
  cat "$BAR_LOG" >&2 || true
  exit 1
}

reset_logs() {
  : >"$QUERY_LOG"
  : >"$BAR_LOG"
  : >"$BAR_CALL_COUNT"
}

expect_bar_invocations() {
  local expected="$1"
  local actual
  actual="$(wc -l <"$BAR_CALL_COUNT" | tr -d ' ')"
  [ "$actual" -eq "$expected" ] || fail "expected $expected sketchybar invocation(s), got $actual"
}

expect_cmd() {
  local expected="$1"
  grep -Fxq -- "$expected" "$BAR_LOG" || fail "missing sketchybar command: $expected"
}

expect_cmd_matching() {
  local pattern="$1"
  grep -Eq -- "$pattern" "$BAR_LOG" || fail "missing sketchybar command matching: $pattern"
}

expect_no_cmd_matching() {
  local pattern="$1"
  if grep -Eq -- "$pattern" "$BAR_LOG"; then
    fail "unexpected sketchybar command matching: $pattern"
  fi
}

source "$plugin_dir/colors.sh"

# 1. Setup creates workspaces, brackets, focus highlights, and separator in ONE batched SketchyBar call.
printf '%s\n' 3 7 8 9 >"$WORKSPACES"
printf '%s\n' 7 >"$FOCUSED_FILE"
reset_logs
"$plugin_path" setup
expect_bar_invocations 1
expect_cmd "--add event aerospace_workspace_change"
expect_cmd "--add bracket space.7.group space.7 space.7.pad.left space.7.app.1 space.7.app.2 space.7.app.3 space.7.app.4 space.7.overflow space.7.pad.right"
expect_cmd "--set space.7.group background.color=$ACTIVE_COLOR background.border_color=$ACCENT_COLOR background.border_width=2"
expect_cmd "--set space.8.group background.color=$ITEM_BG_COLOR background.border_color=$INACTIVE_BORDER_COLOR background.border_width=1"
expect_cmd_matching "^--set space\.7 .*click_script=aerospace workspace 7"
expect_cmd_matching "^--set space_separator .*script=.*aerospace_workspaces\.sh refresh "
expect_cmd "--subscribe space_separator aerospace_workspace_change space_windows_change"

# 2. Refresh resolves cached bundle icons, deduplicates by bundle ID, sorts by app name, caps at 4 + overflow,
#    and renders empty workspaces cleanly — all in ONE batched SketchyBar call.
refresh() {
  local sender="$1"
  local generation="${2:-first-bar}"
  shift 2 || shift 1
  reset_logs
  SENDER="$sender" "$plugin_path" refresh "$generation" "$@"
}

printf '%s\n' \
  '3|Messages|com.apple.MobileSMS' \
  '3|Ghostty|com.mitchellh.ghostty' \
  '3|Ghostty Helper|com.mitchellh.ghostty' \
  '3|Slack|com.tinyspeck.slackmacgap' \
  '3|Notes|' \
  '3|Calendar|com.apple.Calendar' \
  '1|Contacts|com.apple.AddressBook' \
  '7|Safari|com.apple.Safari' >"$WINDOWS"

refresh forced first-bar 3 7 8 9
expect_bar_invocations 1
expect_cmd "--set space.3.group drawing=on"
expect_cmd "--set space.3 drawing=on label.drawing=off label= width=0"
expect_cmd "--set space.3.app.1 drawing=on background.image=app.com.apple.Calendar"
expect_cmd "--set space.3.app.2 drawing=on background.image=app.com.mitchellh.ghostty"
expect_cmd "--set space.3.app.3 drawing=on background.image=app.com.apple.MobileSMS"
expect_cmd "--set space.3.app.4 drawing=on background.image=app.Notes"
expect_cmd "--set space.3.overflow drawing=on label=+1"
expect_no_cmd_matching 'space\.3\.app\.[0-9].*background\.image=app\.(com\.apple\.AddressBook|Ghostty Helper|Messages)'
expect_cmd "--set space.7.app.1 drawing=on background.image=app.com.apple.Safari"
expect_cmd "--set space.8 drawing=on label.drawing=off label= width=12"
expect_cmd "--set space.8.app.1 drawing=off"
expect_cmd "--set space.8.overflow drawing=off label="

# Verify mdfind + PlistBuddy + sips icon caching for Slack when within visible slots.
printf '%s\n' \
  '7|Slack|com.tinyspeck.slackmacgap' \
  '7|Safari|com.apple.Safari' >"$WINDOWS"
refresh space_windows_change first-bar 3 7 8 9
expect_bar_invocations 1
expect_cmd "--set space.7.app.2 drawing=on background.image=$XDG_CACHE_HOME/sketchybar/app-icons/com.tinyspeck.slackmacgap.png"
[ -f "$XDG_CACHE_HOME/sketchybar/app-icons/com.tinyspeck.slackmacgap.png" ] || fail "expected cached Slack icon png"
# Workspace 8 and 9 did not change (workspace 3 became empty, workspace 7 changed).
expect_no_cmd_matching 'space\.[89]\.'

# 3. Differential redraws, window moves, and deduplication stability.
printf '%s\n' '7|Safari|com.apple.Safari' '8|Notes|com.apple.Notes' >"$WINDOWS"
refresh space_windows_change first-bar 7 8 9
expect_bar_invocations 1
expect_cmd "--set space.8.app.1 drawing=on background.image=app.com.apple.Notes"
expect_no_cmd_matching 'space\.9\.'

printf '%s\n' '7|Safari|com.apple.Safari' '7|Notes|com.apple.Notes' >"$WINDOWS"
refresh routine first-bar 7 8 9
expect_bar_invocations 1
expect_cmd "--set space.7.app.1 drawing=on background.image=app.com.apple.Notes"
expect_cmd "--set space.8.app.1 drawing=off"

# Reordering or duplicating windows causes zero redraws.
printf '%s\n' '7|Notes|com.apple.Notes' '7|Notes|com.apple.Notes' '7|Safari|com.apple.Safari' >"$WINDOWS"
refresh space_windows_change first-bar 7 8 9
expect_bar_invocations 0

# 4. Focus change updates active/inactive brackets in one batched SketchyBar call even when apps are unchanged.
reset_logs
FOCUSED_WORKSPACE=8 SENDER=aerospace_workspace_change "$plugin_path" refresh first-bar 7 8 9
expect_bar_invocations 1
expect_cmd "--set space.8.group background.color=$ACTIVE_COLOR background.border_color=$ACCENT_COLOR background.border_width=2"
expect_cmd "--set space.7.group background.color=$ITEM_BG_COLOR background.border_color=$INACTIVE_BORDER_COLOR background.border_width=1"
expect_cmd "--set space.9.group background.color=$ITEM_BG_COLOR background.border_color=$INACTIVE_BORDER_COLOR background.border_width=1"
expect_no_cmd_matching 'space\.[789]\.app\.'

# Repeating the same focus with unchanged apps causes zero redraws.
reset_logs
FOCUSED_WORKSPACE=8 SENDER=aerospace_workspace_change "$plugin_path" refresh first-bar 7 8 9
expect_bar_invocations 0

# 5. An AeroSpace outage must not be mistaken for an empty workspace.
reset_logs
QUERY_FAIL=1 SENDER=routine "$plugin_path" refresh first-bar 7 8 9
expect_bar_invocations 0
refresh routine first-bar 7 8 9
expect_bar_invocations 0

: >"$WINDOWS"
refresh routine first-bar 7 8 9
expect_bar_invocations 1
expect_cmd "--set space.7.app.1 drawing=off"
refresh routine first-bar 7 8 9
expect_bar_invocations 0

# 6. Reload generation forces redraw even with identical window snapshot.
printf '%s\n' '7|Safari|com.apple.Safari' >"$WINDOWS"
refresh routine first-bar 7 8 9
expect_bar_invocations 1
expect_cmd "--set space.7.app.1 drawing=on background.image=app.com.apple.Safari"

refresh forced second-bar 7 8 9
expect_bar_invocations 1
expect_cmd "--set space.7.app.1 drawing=on background.image=app.com.apple.Safari"
