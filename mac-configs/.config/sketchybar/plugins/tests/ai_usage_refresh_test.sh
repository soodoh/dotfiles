#!/bin/sh

set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/../../../../.." && pwd)"
plugin_dir="$repo_root/mac-configs/.config/sketchybar/plugins"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

cat >"$tmp_dir/sketchybar" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SKETCHYBAR_LOG"
EOF
chmod +x "$tmp_dir/sketchybar"

mkdir -p "$tmp_dir/home/.bun/bin"
cat >"$tmp_dir/home/.bun/bin/bun" <<'EOF'
#!/bin/sh
printf '%s\n' '{"text":"Anthropic S12%/W55% · OpenAI W30% ·  M20% · 󰊭 10%"}'
EOF
chmod +x "$tmp_dir/home/.bun/bin/bun"
: >"$tmp_dir/provider-usage-cli.ts"

cat >"$tmp_dir/usage.json" <<'EOF'
{"text":"Anthropic S12%/W55% · OpenAI W30% ·  M20% · 󰊭 10%"}
EOF

assert_contains() {
  needle="$1"
  haystack="$2"
  if ! grep -Fq -- "$needle" "$haystack"; then
    printf 'expected %s to contain: %s\n' "$haystack" "$needle" >&2
    exit 1
  fi
}

log_file="$tmp_dir/sketchybar.log"
: >"$log_file"

HOME="$tmp_dir/home" \
  PATH="$tmp_dir:/usr/bin:/bin" \
  SKETCHYBAR_LOG="$log_file" \
  SKETCHYBAR_BIN="$tmp_dir/sketchybar" \
  PROVIDER_USAGE_CLI="$tmp_dir/provider-usage-cli.ts" \
  bash "$plugin_dir/ai_usage_refresh.sh"

assert_contains 'icon.drawing=off label=Anthropic S12%/W55% · OpenAI W30% ·  M20% · 󰊭 10%' "$log_file"
assert_contains '--set right_separator.ai drawing=on' "$log_file"
assert_contains '--move ai_usage.providers after right_separator.ai' "$log_file"

before_failure="$(cat "$log_file")"
PATH="$tmp_dir:$PATH" \
  SKETCHYBAR_LOG="$log_file" \
  SKETCHYBAR_BIN="$tmp_dir/sketchybar" \
  PROVIDER_USAGE_FIXTURE_PATH="$tmp_dir/usage.json" \
  PROVIDER_USAGE_FIXTURE_EXIT_CODE=1 \
  bash "$plugin_dir/ai_usage_refresh.sh"

if [ "$before_failure" != "$(cat "$log_file")" ]; then
  printf 'failed provider refresh should leave Sketchybar unchanged\n' >&2
  exit 1
fi

printf '{"text":""}\n' >"$tmp_dir/usage.json"
PATH="$tmp_dir:$PATH" \
  SKETCHYBAR_LOG="$log_file" \
  SKETCHYBAR_BIN="$tmp_dir/sketchybar" \
  PROVIDER_USAGE_FIXTURE_PATH="$tmp_dir/usage.json" \
  bash "$plugin_dir/ai_usage_refresh.sh"

assert_contains '--set ai_usage.providers drawing=off --set right_separator.ai drawing=off' "$log_file"
