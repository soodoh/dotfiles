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

cat >"$tmp_dir/osascript" <<'EOF'
#!/bin/sh
printf '%s\n' "67"
EOF
chmod +x "$tmp_dir/osascript"

assert_call() {
  expected="$1"
  if ! grep -Fxq -- "$expected" "$log_file"; then
    printf 'expected sketchybar call not found: %s\n' "$expected" >&2
    printf 'actual calls:\n' >&2
    cat "$log_file" >&2
    exit 1
  fi
}

assert_no_call() {
  if [ -s "$log_file" ]; then
    printf 'expected no sketchybar calls, but got:\n' >&2
    cat "$log_file" >&2
    exit 1
  fi
}

PATH="$tmp_dir:$PATH" SKETCHYBAR_LOG="$log_file" SENDER=volume_change INFO=34 NAME=volume sh "$plugin_dir/volume.sh"
assert_call '--set volume icon=󰖀 label=34%'

: >"$log_file"
PATH="$tmp_dir:$PATH" SKETCHYBAR_LOG="$log_file" VOLUME_FALLBACK=0 NAME=volume sh "$plugin_dir/volume.sh"
assert_call '--set volume icon=󰖁 label=0%'

: >"$log_file"
PATH="$tmp_dir:$PATH" SKETCHYBAR_LOG="$log_file" OSASCRIPT_LOG="$tmp_dir/osascript.log" NAME=volume sh "$plugin_dir/volume.sh"
assert_call '--set volume icon=󰕾 label=67%'

: >"$log_file"
PATH="$tmp_dir:$PATH" SKETCHYBAR_LOG="$log_file" VOLUME_FALLBACK=101 NAME=volume sh "$plugin_dir/volume.sh"
assert_no_call
