#!/bin/sh

set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/../../../../.." && pwd)"
plugin_dir="$repo_root/mac-configs/.config/sketchybar/plugins"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

log_file="$tmp_dir/sketchybar.log"
: >"$log_file"

cat >"$tmp_dir/sketchybar" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SKETCHYBAR_LOG"
EOF
chmod +x "$tmp_dir/sketchybar"

cat >"$tmp_dir/aerospace" <<'EOF'
#!/bin/sh
printf '%s\n' "aerospace $*" >> "$AEROSPACE_LOG"
printf '%s\n' "Terminal"
EOF
chmod +x "$tmp_dir/aerospace"

assert_call() {
  expected="$1"
  if ! grep -Fxq -- "$expected" "$log_file"; then
    printf 'expected sketchybar call not found: %s\n' "$expected" >&2
    printf 'actual calls:\n' >&2
    cat "$log_file" >&2
    exit 1
  fi
}

assert_no_aerospace_call() {
  if [ -s "$tmp_dir/aerospace.log" ]; then
    printf 'expected no aerospace calls, but got:\n' >&2
    cat "$tmp_dir/aerospace.log" >&2
    exit 1
  fi
}

PATH="$tmp_dir:$PATH" SKETCHYBAR_LOG="$log_file" SENDER=front_app_switched INFO=Ghostty NAME=front_app sh "$plugin_dir/front_app.sh"
assert_call '--set front_app label=Ghostty'

: >"$log_file"
: >"$tmp_dir/aerospace.log"
PATH="$tmp_dir:$PATH" SKETCHYBAR_LOG="$log_file" AEROSPACE_LOG="$tmp_dir/aerospace.log" SENDER=front_app_switched INFO= NAME=front_app sh "$plugin_dir/front_app.sh"
assert_call '--set front_app label='
assert_no_aerospace_call

: >"$log_file"
PATH="$tmp_dir:$PATH" SKETCHYBAR_LOG="$log_file" FRONT_APP_FALLBACK=Zen NAME=front_app sh "$plugin_dir/front_app.sh"
assert_call '--set front_app label=Zen'

: >"$log_file"
PATH="$tmp_dir:$PATH" SKETCHYBAR_LOG="$log_file" AEROSPACE_LOG="$tmp_dir/aerospace.log" NAME=front_app sh "$plugin_dir/front_app.sh"
assert_call '--set front_app label=Terminal'
