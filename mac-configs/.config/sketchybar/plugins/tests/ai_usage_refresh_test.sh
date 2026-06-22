#!/bin/sh

set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/../../../../.." && pwd)"
plugin_dir="$repo_root/mac-configs/.config/sketchybar/plugins"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

cat >"$tmp_dir/curl" <<'EOF'
#!/bin/sh
cat <<'JSON'
{
  "error": {
    "message": "Budget has been exceeded! Current cost: 322.29367038, Max budget: 320.0",
    "type": "budget_exceeded",
    "param": null,
    "code": "400"
  }
}
JSON
EOF
chmod +x "$tmp_dir/curl"

cat >"$tmp_dir/sketchybar" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SKETCHYBAR_LOG"
EOF
chmod +x "$tmp_dir/sketchybar"

cat >"$tmp_dir/codexbar.json" <<'EOF'
[]
EOF

cat >"$tmp_dir/settings.json" <<'EOF'
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://llm.example.com",
    "ANTHROPIC_AUTH_TOKEN": "test-token"
  }
}
EOF

assert_equals() {
  expected="$1"
  actual="$2"
  if [ "$actual" != "$expected" ]; then
    printf 'expected: %s\nactual:   %s\n' "$expected" "$actual" >&2
    exit 1
  fi
}

log_file="$tmp_dir/sketchybar.log"
: >"$log_file"

PATH="$tmp_dir:$PATH" \
  SKETCHYBAR_LOG="$log_file" \
  CODEXBAR_FIXTURE_PATH="$tmp_dir/codexbar.json" \
  CLAUDE_SETTINGS_PATH="$tmp_dir/settings.json" \
  CACHE_DIR="$tmp_dir/cache" \
  AI_USAGE_NOW_EPOCH=1770000000 \
  bash "$plugin_dir/ai_usage_refresh.sh"

cache_path="$tmp_dir/cache/ai_usage.json"
assert_equals 'litellm_monthly_spend' "$(jq -r '.providers[0].id' "$cache_path")"
assert_equals '$322.29' "$(jq -r '.providers[0].label' "$cache_path")"
assert_equals 'false' "$(jq -r '.stale' "$cache_path")"
