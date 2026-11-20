#!/bin/sh
set -eu

plugin_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

export PATH="$tmp_dir:$PATH"
export CONFIG_DIR="${plugin_dir%/plugins}"
export XDG_CACHE_HOME="$tmp_dir/cache" APP_ICON_CACHE_DIR="$tmp_dir/icons" MDFIND_BIN=false
export WINDOWS="$tmp_dir/windows" QUERY_LOG="$tmp_dir/aerospace.log" BAR_LOG="$tmp_dir/bar.log"

cat >"$tmp_dir/aerospace" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$QUERY_LOG"
[ "$1" = list-windows ] && [ "$2" = --all ] && [ "${QUERY_FAIL:-0}" = 0 ] || exit 1
cat "$WINDOWS"
EOF
cat >"$tmp_dir/sketchybar" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$BAR_LOG"
EOF
chmod +x "$tmp_dir/aerospace" "$tmp_dir/sketchybar"

fail() {
  printf '%s\n' "$*" >&2
  printf 'AeroSpace calls:\n' >&2
  cat "$QUERY_LOG" >&2
  printf 'SketchyBar calls:\n' >&2
  cat "$BAR_LOG" >&2
  exit 1
}

refresh() {
  : >"$QUERY_LOG"
  : >"$BAR_LOG"
  SENDER="$1" bash "$plugin_dir/aerospace_workspace_change.sh" "${2:-first-bar}" 7 8 9
  [ "$(wc -l <"$QUERY_LOG")" -eq 1 ] || fail "expected one snapshot for $1"
}

expect_app() {
  grep -Eq "^--set space\.$1\.app\..*drawing=on background\.image=app\.$2$" "$BAR_LOG" ||
    fail "expected $2 to appear in workspace $1"
}

expect_empty() {
  grep -Fxq -- "--set space.$1.app.1 drawing=off" "$BAR_LOG" ||
    fail "expected workspace $1 to clear its icons"
}

expect_no_redraw() {
  [ ! -s "$BAR_LOG" ] || fail 'expected no redraw'
}

printf '%s\n' '7|Safari|com.apple.Safari' >"$WINDOWS"
refresh forced
expect_app 7 com.apple.Safari

# An app can be routed to an unfocused workspace while workspace 7 stays focused.
printf '%s\n' '7|Safari|com.apple.Safari' '8|Notes|com.apple.Notes' >"$WINDOWS"
refresh space_windows_change
expect_app 8 com.apple.Notes
if grep -Eq 'space\.[79]\.' "$BAR_LOG"; then fail 'redrew a workspace that did not change'; fi

# A move without a workspace switch updates both ends. A timer also covers
# events that are missed or run before AeroSpace has processed the move.
printf '%s\n' '7|Safari|com.apple.Safari' '7|Notes|com.apple.Notes' >"$WINDOWS"
refresh routine
expect_app 7 com.apple.Notes
expect_empty 8

# Reordering or duplicating windows does not change the displayed apps.
printf '%s\n' '7|Notes|com.apple.Notes' '7|Notes|com.apple.Notes' '7|Safari|com.apple.Safari' >"$WINDOWS"
refresh space_windows_change
expect_no_redraw

# An AeroSpace outage must not be mistaken for an empty workspace.
QUERY_FAIL=1 refresh routine
expect_no_redraw
refresh routine
expect_no_redraw
: >"$WINDOWS"
refresh routine
expect_empty 7
refresh routine
expect_no_redraw

# On reload the groups are recreated even if AeroSpace's snapshot is unchanged.
printf '%s\n' '7|Safari|com.apple.Safari' >"$WINDOWS"
refresh routine
expect_app 7 com.apple.Safari
refresh forced second-bar
expect_app 7 com.apple.Safari
