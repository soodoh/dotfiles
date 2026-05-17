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

assert_equals() {
	expected="$1"
	actual="$2"
	if [ "$actual" != "$expected" ]; then
		printf 'expected: %s\nactual:   %s\n' "$expected" "$actual" >&2
		exit 1
	fi
}

assert_call() {
	expected="$1"
	if ! grep -Fxq -- "$expected" "$log_file"; then
		printf 'expected sketchybar call not found: %s\n' "$expected" >&2
		printf 'actual calls:\n' >&2
		cat "$log_file" >&2
		exit 1
	fi
}

assert_call_count() {
	expected="$1"
	expected_count="$2"
	actual_count="$(grep -Fx -- "$expected" "$log_file" | wc -l | tr -d ' ')"
	if [ "$actual_count" != "$expected_count" ]; then
		printf 'expected sketchybar call count %s for: %s\n' "$expected_count" "$expected" >&2
		printf 'actual count: %s\n' "$actual_count" >&2
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

resolve_workspace_app_image() {
	app_name="$1"
	bundle_id="${2:-}"

	PATH="$tmp_dir:$PATH" \
		PLUGIN_PATH="$plugin_path" \
		bash -c '. "$PLUGIN_PATH"; resolve_workspace_app_image "$1" "$2"' \
		resolve-workspace-app-image "$app_name" "$bundle_id"
}

extract_workspace_apps_from_windows() {
	window_records="$1"

	printf '%s' "$window_records" | \
		PATH="$tmp_dir:$PATH" \
		PLUGIN_PATH="$plugin_path" \
		bash -c '. "$PLUGIN_PATH"; extract_workspace_apps_from_windows'
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
assert_call '--set space.7 width=12'

assert_equals 'app.com.apple.MobileSMS' "$(resolve_workspace_app_image Messages com.apple.MobileSMS)"
assert_equals 'app.com.mitchellh.ghostty' "$(resolve_workspace_app_image Ghostty com.mitchellh.ghostty)"
assert_equals 'app.Notes' "$(resolve_workspace_app_image Notes '')"
assert_equals '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns' "$(resolve_workspace_app_image '' '')"

expected_extracted_records="Messages|com.apple.MobileSMS
Ghostty|com.mitchellh.ghostty"
assert_equals "$expected_extracted_records" "$(extract_workspace_apps_from_windows "3|Messages|com.apple.MobileSMS
1|Ghostty|com.mitchellh.ghostty")"

: >"$log_file"
render_workspace_items 3 "Messages|com.apple.MobileSMS
Ghostty|com.mitchellh.ghostty
Ghostty Helper|com.mitchellh.ghostty
Safari|com.apple.Safari
Notes|
Calendar|com.apple.Calendar"
assert_call '--set space.3.group drawing=on'
assert_call '--set space.3 drawing=on label.drawing=off label='
assert_call '--set space.3 width=0'
assert_call '--set space.3.app.1 drawing=on background.image=app.com.apple.MobileSMS'
assert_call '--set space.3.app.2 drawing=on background.image=app.com.mitchellh.ghostty'
assert_call_count '--set space.3.app.2 drawing=on background.image=app.com.mitchellh.ghostty' 1
assert_call '--set space.3.app.3 drawing=on background.image=app.com.apple.Safari'
assert_call '--set space.3.app.4 drawing=on background.image=app.Notes'
assert_call '--set space.3.overflow drawing=on label=+1'
assert_no_call_matching 'space\.3\.app\.[0-9].*background\.image=app\.Messages'
assert_no_call_matching 'space\.3\.app\.[0-9].*background\.image=app\.Ghostty Helper'
assert_no_call_matching 'space\.3\.app\.[0-9].*background\.image=app\.com\.apple\.Calendar'
