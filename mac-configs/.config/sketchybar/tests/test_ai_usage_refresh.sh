#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/mac-configs/.config/sketchybar/plugins"
TEST_DIR="$ROOT_DIR/mac-configs/.config/sketchybar/tests"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/sketchybar" <<'EOF'
#!/bin/bash
if [[ "${1:-}" == "--query" && "${2:-}" == "bar" ]]; then
  exit "${SKETCHYBAR_QUERY_BAR_EXIT_CODE:-0}"
fi

printf '%s\n' "$*" >> "$SKETCHYBAR_LOG"

if [[ "${SKETCHYBAR_FAIL_BATCH_ONCE:-0}" == "1" ]]; then
  if [[ "$*" == *'--set ai_usage.'* ]]; then
    batch_set_count="$(grep -o -- '--set ai_usage\.' <<<"$*" | wc -l | tr -d ' ')"
    if [[ "$batch_set_count" -gt 1 && ! -f "$SKETCHYBAR_LOG.batch_failed" ]]; then
      touch "$SKETCHYBAR_LOG.batch_failed"
      exit 1
    fi
  fi
fi
EOF
chmod +x "$TMP_DIR/sketchybar"

export SKETCHYBAR_LOG="$TMP_DIR/sketchybar.log"

run_refresh() {
  local fixture_path="$1"
  local exit_code="${2:-0}"
  PATH="$TMP_DIR:$PATH" \
    AI_USAGE_CACHE_PATH="$TMP_DIR/ai_usage.json" \
    AI_USAGE_STATE_PATH="$TMP_DIR/ai_usage.state" \
    AI_USAGE_NOW_EPOCH="1775782456" \
    SKETCHYBAR_QUERY_BAR_EXIT_CODE="${SKETCHYBAR_QUERY_BAR_EXIT_CODE:-0}" \
    CODEXBAR_FIXTURE_PATH="$fixture_path" \
    CODEXBAR_FIXTURE_EXIT_CODE="$exit_code" \
    "$PLUGIN_DIR/ai_usage_refresh.sh"
}

assert_json() {
  local jq_filter="$1"
  local expected="$2"
  local actual
  actual="$(jq -r "$jq_filter" "$TMP_DIR/ai_usage.json")"
  if [[ "$actual" != "$expected" ]]; then
    echo "expected '$expected' but got '$actual' for filter: $jq_filter" >&2
    exit 1
  fi
}

assert_log_contains() {
  local needle="$1"
  if ! grep -F -- "$needle" "$SKETCHYBAR_LOG" >/dev/null; then
    echo "expected log to contain: $needle" >&2
    exit 1
  fi
}

assert_log_line_contains() {
  local pattern="$1"
  shift

  local line
  line="$(grep -F -m1 -- "$pattern" "$SKETCHYBAR_LOG")"
  if [[ -z "$line" ]]; then
    echo "expected log line containing: $pattern" >&2
    exit 1
  fi

  local fragment
  for fragment in "$@"; do
    if [[ "$line" != *"$fragment"* ]]; then
      echo "expected log line containing '$pattern' to also contain: $fragment" >&2
      exit 1
    fi
  done
}

assert_pattern_order() {
  local first_pattern="$1"
  local second_pattern="$2"
  local first_line
  local second_line

  first_line="$(grep -n -F -m1 -- "$first_pattern" "$SKETCHYBAR_LOG" | cut -d: -f1)"
  second_line="$(grep -n -F -m1 -- "$second_pattern" "$SKETCHYBAR_LOG" | cut -d: -f1)"

  if [[ -z "$first_line" || -z "$second_line" ]]; then
    echo "expected patterns for order check: $first_pattern then $second_pattern" >&2
    exit 1
  fi

  if (( first_line >= second_line )); then
    echo "expected '$first_pattern' before '$second_pattern'" >&2
    exit 1
  fi
}

run_refresh "$TEST_DIR/fixtures/codexbar-usage-mixed.json" 1
assert_json '.stale' 'false'
assert_json '.generatedAt' '2026-04-10T00:54:16Z'
assert_json '.providers | length' '3'
assert_json '[.providers[].id] | join(",")' 'codex,claude,copilot'
assert_json '[.providers[] | select(.id == "cursor")] | length' '0'
assert_json '[.providers[] | select(.id == "warp")] | length' '0'
assert_json '.providers[] | select(.id == "codex") | .order' '0'
assert_json '.providers[] | select(.id == "codex") | .sessionUsedPercent' '27'
assert_json '.providers[] | select(.id == "codex") | .icon' '../assets/ai_usage/codex.png'
assert_json '.providers[] | select(.id == "codex") | .source' 'codex-cli'
assert_json '.providers[] | select(.id == "codex") | .updatedAt' '2026-04-10T00:54:16Z'
assert_json '.providers[] | select(.id == "claude") | .order' '1'
assert_json '.providers[] | select(.id == "claude") | .icon' '../assets/ai_usage/claude.png'
assert_json '.providers[] | select(.id == "claude") | .weeklyUsedPercent' '73'
assert_json '.providers[] | select(.id == "claude") | .loginMethod' 'Claude Max'
assert_json '.providers[] | select(.id == "claude") | .weeklyResetDescription' 'Apr 9 at 9:00PM'
assert_json '.providers[] | select(.id == "copilot") | .order' '2'
assert_json '.providers[] | select(.id == "copilot") | .icon' '../assets/ai_usage/copilot.png'
assert_json '.providers[] | select(.id == "copilot") | .source' 'api'
assert_json '.providers[] | select(.id == "copilot") | .updatedAt' '2026-04-10T00:54:20Z'
assert_json '.providers[] | select(.id == "copilot") | .sessionResetDescription // ""' ''
assert_log_line_contains '--set ai_usage.codex' \
  '--set ai_usage.codex drawing=on' \
  '/codex.png' \
  'label=27%' \
  'label.color=0xffffffff' \
  '--set ai_usage.claude drawing=on' \
  '/claude.png' \
  '--set ai_usage.copilot drawing=on' \
  '/copilot.png'
assert_log_line_contains '--set right_separator.ai' \
  '--set right_separator.ai drawing=on' \
  'icon=│' \
  'label.drawing=off' \
  'icon.color=0x66ffffff' \
  'icon.padding_left=6' \
  'icon.padding_right=6' \
  'background.drawing=off'
if grep -F -- '--add item right_separator.ai right' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect visible refresh to add right_separator.ai" >&2
  exit 1
fi
assert_log_contains '--move right_separator.ai after ram'
assert_log_contains '--move ai_usage.codex after right_separator.ai'
assert_log_contains '--move ai_usage.claude after right_separator.ai'
assert_log_contains '--move ai_usage.copilot after right_separator.ai'
assert_pattern_order '--move right_separator.ai after ram' '--move ai_usage.copilot after right_separator.ai'
assert_pattern_order '--move ai_usage.copilot after right_separator.ai' '--move ai_usage.claude after right_separator.ai'
assert_pattern_order '--move ai_usage.claude after right_separator.ai' '--move ai_usage.codex after right_separator.ai'
if grep -F -- '--move ai_usage.codex after right_separator.system' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect AI items to anchor directly to right_separator.system" >&2
  exit 1
fi
if grep -F -- 'script=AI_PROVIDER_ID=' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect delegated provider script wiring" >&2
  exit 1
fi
if grep -F -- 'ai_usage_item.sh' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect ai_usage_item.sh wiring" >&2
  exit 1
fi
if grep -F -- '--set ai_usage.codex drawing=on update_freq=60' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect per-provider update_freq wiring" >&2
  exit 1
fi
if [[ "$(grep -cF -- '--set ai_usage.' "$SKETCHYBAR_LOG")" != "1" ]]; then
  echo "expected batched direct provider render updates" >&2
  exit 1
fi
if grep -F -- 'click_script=' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect ai usage click_script wiring" >&2
  exit 1
fi
if grep -F -- 'popup.' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect ai usage popup properties" >&2
  exit 1
fi
if grep -F -- 'ai_usage_bracket' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect dynamic ai_usage_bracket output" >&2
  exit 1
fi

cp "$TMP_DIR/ai_usage.json" "$TMP_DIR/previous.json"
: > "$SKETCHYBAR_LOG"
run_refresh "$TEST_DIR/fixtures/codexbar-usage-invalid.txt" 1
assert_json '.stale' 'true'
assert_json '.providers | length' '3'
assert_log_line_contains 'label.color=0x88ffffff' \
  '--set ai_usage.codex drawing=on' \
  '/codex.png' \
  'label=27%' \
  'label.color=0x88ffffff'
if ! diff -u \
  <(jq -S 'del(.stale)' "$TMP_DIR/previous.json") \
  <(jq -S 'del(.stale)' "$TMP_DIR/ai_usage.json") >/dev/null; then
  echo "stale refresh changed fields other than stale" >&2
  exit 1
fi

rm -f "$TMP_DIR/ai_usage.json"
: > "$SKETCHYBAR_LOG"
run_refresh "$TEST_DIR/fixtures/codexbar-usage-invalid.txt" 1
assert_json '.generatedAt' ''
assert_json '.stale' 'true'
assert_json '.providers | length' '0'
assert_log_contains '--set ai_usage.codex drawing=off'
assert_log_contains '--set ai_usage.claude drawing=off'
assert_log_contains '--set ai_usage.copilot drawing=off'
assert_log_contains '--set right_separator.ai drawing=off'
if grep -F -- '--add item right_separator.ai right' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect empty refresh to add right_separator.ai" >&2
  exit 1
fi
test ! -s "$TMP_DIR/ai_usage.state"
if grep -F -- 'ai_usage_bracket' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect dynamic ai_usage_bracket output" >&2
  exit 1
fi

: > "$SKETCHYBAR_LOG"
run_refresh "$TEST_DIR/fixtures/codexbar-usage-mixed.json" 1
assert_json '.stale' 'false'
assert_json '.providers | length' '3'
assert_log_contains '--set right_separator.ai drawing=on'
assert_log_contains '--move right_separator.ai after ram'
assert_log_contains '--move ai_usage.codex after right_separator.ai'
assert_pattern_order '--move right_separator.ai after ram' '--move ai_usage.codex after right_separator.ai'
test -s "$TMP_DIR/ai_usage.state"
if grep -F -- 'ai_usage_bracket' "$SKETCHYBAR_LOG" >/dev/null; then
  echo "did not expect dynamic ai_usage_bracket output" >&2
  exit 1
fi

CONCURRENT_DIR="$TMP_DIR/concurrent"
mkdir -p "$CONCURRENT_DIR"
refresh_job() {
  local fixture_path="$1"
  local state_signal_path="${2:-}"
  local state_wait_path="${3:-}"
  local cache_name="${4:-$(basename "$fixture_path" | tr -c '[:alnum:].' '_')}"
  PATH="$TMP_DIR:$PATH" \
    AI_USAGE_CACHE_PATH="$CONCURRENT_DIR/$cache_name" \
    AI_USAGE_STATE_PATH="$CONCURRENT_DIR/ai_usage.state" \
    AI_USAGE_NOW_EPOCH="1775782456" \
    SKETCHYBAR_QUERY_BAR_EXIT_CODE="${SKETCHYBAR_QUERY_BAR_EXIT_CODE:-0}" \
    CODEXBAR_FIXTURE_PATH="$fixture_path" \
    CODEXBAR_FIXTURE_EXIT_CODE="1" \
    SKETCHYBAR_LOG="$CONCURRENT_DIR/sketchybar.log" \
    AI_USAGE_STATE_SYNC_SIGNAL_PATH="$state_signal_path" \
    AI_USAGE_STATE_SYNC_WAIT_PATH="$state_wait_path" \
    "$PLUGIN_DIR/ai_usage_refresh.sh"
}

SINGLE_PROVIDER_FIXTURE="$TMP_DIR/codexbar-usage-codex-only.json"
cat > "$SINGLE_PROVIDER_FIXTURE" <<'EOF'
[
  {
    "provider": "codex",
    "source": "codex-cli",
    "usage": {
      "primary": {
        "usedPercent": 41,
        "resetDescription": "Apr 10 at 12:00AM"
      },
      "updatedAt": "2026-04-10T00:54:16Z"
    }
  }
]
EOF

: > "$CONCURRENT_DIR/sketchybar.log"
MIXED_SIGNAL_PATH="$CONCURRENT_DIR/mixed-read.signal"
MIXED_WAIT_PATH="$CONCURRENT_DIR/mixed-read.wait"
SUBSET_SIGNAL_PATH="$CONCURRENT_DIR/subset-read.signal"
SUBSET_WAIT_PATH="$CONCURRENT_DIR/subset-read.wait"
touch "$MIXED_WAIT_PATH" "$SUBSET_WAIT_PATH"

refresh_job "$TEST_DIR/fixtures/codexbar-usage-mixed.json" "$MIXED_SIGNAL_PATH" "$MIXED_WAIT_PATH" "mixed-cache.json" &
pid_one=$!
while [[ ! -f "$MIXED_SIGNAL_PATH" ]]; do
  sleep 0.01
done

refresh_job "$SINGLE_PROVIDER_FIXTURE" "$SUBSET_SIGNAL_PATH" "$SUBSET_WAIT_PATH" "subset-cache.json" &
pid_two=$!
sleep 0.1
rm -f "$MIXED_WAIT_PATH"
sleep 0.1
rm -f "$SUBSET_WAIT_PATH"
wait "$pid_one"
wait "$pid_two"
test -f "$CONCURRENT_DIR/subset-cache.json"
test "$(jq '.providers | length' "$CONCURRENT_DIR/subset-cache.json")" = "1"
test "$(jq -r '.providers[0].id' "$CONCURRENT_DIR/subset-cache.json")" = "codex"
test "$(cat "$CONCURRENT_DIR/ai_usage.state")" = "codex"
if [[ "$(grep -cF -- '--set ai_usage.claude drawing=off' "$CONCURRENT_DIR/sketchybar.log")" -lt 1 ]]; then
  echo "expected overlapping mixed and codex-only refreshes to hide stale claude item" >&2
  exit 1
fi
if [[ "$(grep -cF -- '--set ai_usage.copilot drawing=off' "$CONCURRENT_DIR/sketchybar.log")" -lt 1 ]]; then
  echo "expected overlapping mixed and codex-only refreshes to hide stale copilot item" >&2
  exit 1
fi

: > "$SKETCHYBAR_LOG"
SKETCHYBAR_FAIL_BATCH_ONCE="1" run_refresh "$TEST_DIR/fixtures/codexbar-usage-mixed.json" 1
test "$(grep -cF -- '--set ai_usage.' "$SKETCHYBAR_LOG")" = "4"
grep -F -- '--set ai_usage.codex drawing=on' "$SKETCHYBAR_LOG"
grep -F -- '--set ai_usage.claude drawing=on' "$SKETCHYBAR_LOG"
grep -F -- '--set ai_usage.copilot drawing=on' "$SKETCHYBAR_LOG"

MALICIOUS_FIXTURE="$TMP_DIR/codexbar-usage-malicious.json"
cat > "$MALICIOUS_FIXTURE" <<EOF
[
  {
    "provider": "codex\$(touch eval_pwned)",
    "source": "codex-cli",
    "usage": {
      "primary": {
        "usedPercent": 27,
        "resetDescription": "Apr 10 at 12:00AM"
      },
      "updatedAt": "2026-04-10T00:54:16Z"
    }
  }
]
EOF

: > "$SKETCHYBAR_LOG"
rm -f "$TMP_DIR/eval_pwned"
(
  cd "$TMP_DIR"
  run_refresh "$MALICIOUS_FIXTURE" 0
)
test ! -f "$TMP_DIR/eval_pwned"
grep -F -- 'ai_usage.codex$(touch' "$SKETCHYBAR_LOG"

TRAVERSAL_FIXTURE="$TMP_DIR/codexbar-usage-traversal.json"
cat > "$TRAVERSAL_FIXTURE" <<'EOF'
[
  {
    "provider": "../../escape",
    "source": "codex-cli",
    "usage": {
      "primary": {
        "usedPercent": 11,
        "resetDescription": "Apr 10 at 12:00AM"
      },
      "updatedAt": "2026-04-10T00:54:16Z"
    }
  }
]
EOF

rm -f "$TMP_DIR/escape.json"
: > "$SKETCHYBAR_LOG"
run_refresh "$TRAVERSAL_FIXTURE" 0
test ! -e "$TMP_DIR/escape.json"
grep -F -- 'ai_usage.../../escape' "$SKETCHYBAR_LOG"

: > "$SKETCHYBAR_LOG"
SKETCHYBAR_QUERY_BAR_EXIT_CODE="1" run_refresh "$TEST_DIR/fixtures/codexbar-usage-mixed.json" 1
grep -F -- '--set ai_usage.codex' "$SKETCHYBAR_LOG"

echo "PASS test_ai_usage_refresh"
