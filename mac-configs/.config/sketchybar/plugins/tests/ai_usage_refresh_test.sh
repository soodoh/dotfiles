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

mkdir -p "$tmp_dir/home/.bun/bin" "$tmp_dir/home/.pi/agent"
cat >"$tmp_dir/home/.pi/agent/models.json" <<'EOF'
{"providers":{"llm-hub":{"baseUrl":"https://llm-hub.test","api":"anthropic-messages","models":[{"id":"claude-sonnet-5"}]}}}
EOF
cat >"$tmp_dir/home/.pi/agent/auth.json" <<'EOF'
{"llm-hub":{"type":"api_key","key":"isolated-test-token"}}
EOF
chmod 600 "$tmp_dir/home/.pi/agent/auth.json"
cat >"$tmp_dir/home/.bun/bin/bun" <<'EOF'
#!/bin/sh
if env | grep -Eq '^(ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|LLMHUB_BASE_URL|LLMHUB_AUTH_TOKEN)='; then
  printf '%s\n' 'provider secret environment leaked into clean execution' >&2
  exit 1
fi
[ -f "$HOME/.pi/agent/models.json" ] && [ -f "$HOME/.pi/agent/auth.json" ] || exit 1
printf '%s\n' '{"text":"Anthropic S12%/W55% · OpenAI 30% ·  20% · 󰊭 10%"}'
EOF
chmod +x "$tmp_dir/home/.bun/bin/bun"
: >"$tmp_dir/provider-usage-cli.ts"

cat >"$tmp_dir/usage.json" <<'EOF'
{"text":"Anthropic S12%/W55% · OpenAI 30% ·  20% · 󰊭 10%"}
EOF

assert_contains() {
  needle="$1"
  haystack="$2"
  if ! grep -Fq -- "$needle" "$haystack"; then
    printf 'expected %s to contain: %s\n' "$haystack" "$needle" >&2
    exit 1
  fi
}

sketchybarrc="$repo_root/mac-configs/.config/sketchybar/sketchybarrc"
assert_contains 'updates=on' "$sketchybarrc"
assert_contains '--subscribe ai_usage.refresh system_woke' "$sketchybarrc"

log_file="$tmp_dir/sketchybar.log"
usage_log="$tmp_dir/ai-usage.log"
: >"$log_file"

env -i \
  HOME="$tmp_dir/home" \
  PATH="$tmp_dir:/usr/bin:/bin" \
  BUN_BIN="$tmp_dir/home/.bun/bin/bun" \
  SKETCHYBAR_LOG="$log_file" \
  SKETCHYBAR_BIN="$tmp_dir/sketchybar" \
  AI_USAGE_LOG_PATH="$usage_log" \
  PROVIDER_USAGE_CLI="$tmp_dir/provider-usage-cli.ts" \
  /bin/bash "$plugin_dir/ai_usage_refresh.sh"

assert_contains 'icon.drawing=off label=Anthropic S12%/W55% · OpenAI 30% ·  20% · 󰊭 10%' "$log_file"
assert_contains '--set right_separator.ai drawing=on' "$log_file"
assert_contains '--move ai_usage.providers after right_separator.ai' "$log_file"

printf '{"text":"Standalone 42%%"}\n' >"$tmp_dir/usage.json"
PATH="$tmp_dir:$PATH" \
  SKETCHYBAR_LOG="$log_file" \
  SKETCHYBAR_BIN="$tmp_dir/sketchybar" \
  AI_USAGE_LOG_PATH=/dev/full \
  PROVIDER_USAGE_FIXTURE_PATH="$tmp_dir/usage.json" \
  bash "$plugin_dir/ai_usage_refresh.sh"
assert_contains 'label=Standalone 42%' "$log_file"

before_failure="$(cat "$log_file")"
PATH="$tmp_dir:$PATH" \
  SKETCHYBAR_LOG="$log_file" \
  SKETCHYBAR_BIN="$tmp_dir/sketchybar" \
  AI_USAGE_LOG_PATH="$usage_log" \
  PROVIDER_USAGE_FIXTURE_PATH="$tmp_dir/usage.json" \
  PROVIDER_USAGE_FIXTURE_EXIT_CODE=1 \
  bash "$plugin_dir/ai_usage_refresh.sh"

if [ "$before_failure" != "$(cat "$log_file")" ]; then
  printf 'failed provider refresh should leave Sketchybar unchanged\n' >&2
  exit 1
fi
assert_contains 'provider usage CLI failed' "$usage_log"

printf '{"text":""}\n' >"$tmp_dir/usage.json"
PATH="$tmp_dir:$PATH" \
  SKETCHYBAR_LOG="$log_file" \
  SKETCHYBAR_BIN="$tmp_dir/sketchybar" \
  AI_USAGE_LOG_PATH="$usage_log" \
  PROVIDER_USAGE_FIXTURE_PATH="$tmp_dir/usage.json" \
  bash "$plugin_dir/ai_usage_refresh.sh"

assert_contains '--set ai_usage.providers drawing=off --set right_separator.ai drawing=off' "$log_file"
