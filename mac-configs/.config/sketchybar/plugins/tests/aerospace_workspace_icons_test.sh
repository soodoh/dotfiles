#!/bin/sh

set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/../../../../.." && pwd)"
plugin_dir="$repo_root/mac-configs/.config/sketchybar/plugins"
plugin_path="$plugin_dir/aerospace_workspace_icons.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

log_file="$tmp_dir/sketchybar.log"
: >"$log_file"

cat >"$tmp_dir/sketchybar" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SKETCHYBAR_LOG"
EOF
chmod +x "$tmp_dir/sketchybar"

cat >"$tmp_dir/mdfind" <<'EOF'
#!/bin/sh
printf '%s\n' "/Applications/Fake.app"
EOF
chmod +x "$tmp_dir/mdfind"

assert_call() {
	expected="$1"
	if ! grep -Fxq -- "$expected" "$log_file"; then
		printf 'expected sketchybar call not found: %s\n' "$expected" >&2
		printf 'actual calls:\n' >&2
		cat "$log_file" >&2
		exit 1
	fi
}

assert_no_call_matching() {
	pattern="$1"
	if grep -Eq -- "$pattern" "$log_file"; then
		printf 'expected no sketchybar call matching: %s\n' "$pattern" >&2
		printf 'actual calls:\n' >&2
		cat "$log_file" >&2
		exit 1
	fi
}

render_workspace_items() {
	workspace_id="$1"
	raw_apps="$2"

	PATH="$tmp_dir:$PATH" \
		SKETCHYBAR_LOG="$log_file" \
		PLUGIN_PATH="$plugin_path" \
		bash -c '. "$PLUGIN_PATH"; render_workspace_items "$1" "$2"' \
		render-workspace-items "$workspace_id" "$raw_apps"
}

render_workspace_items 7 ""
assert_call '--set space.7.group drawing=on'
assert_call '--set space.7 drawing=on label.drawing=off label='
assert_call '--set space.7.app.1 drawing=off'
assert_call '--set space.7.app.2 drawing=off'
assert_call '--set space.7.app.3 drawing=off'
assert_call '--set space.7.app.4 drawing=off'
assert_call '--set space.7.overflow drawing=off label='
assert_no_call_matching 'space\.7\.app\.[0-9].*background\.image='
assert_no_call_matching 'space\.7\.overflow.*label=\+'
assert_call '--set space.7 width=24'

: >"$log_file"
render_workspace_items 3 "Ghostty
Safari
Mail
Notes
Calendar
Ghostty"
assert_call '--set space.3.group drawing=on'
assert_call '--set space.3 drawing=on label.drawing=off label='
assert_call '--set space.3 width=0'
assert_call '--set space.3.app.1 drawing=on background.image=app.Ghostty'
assert_call '--set space.3.app.2 drawing=on background.image=app.Safari'
assert_call '--set space.3.app.3 drawing=on background.image=app.Mail'
assert_call '--set space.3.app.4 drawing=on background.image=app.Notes'
assert_call '--set space.3.overflow drawing=on label=+1'
assert_no_call_matching 'space\.3\.app\.[0-9].*background\.image=app\.Calendar'
