#!/bin/sh
if [ -z "${BASH_VERSION:-}" ] || shopt -oq posix; then
  exec /bin/bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/colors.sh"
PI_EXTENSIONS_DIR="${PI_EXTENSIONS_DIR:-$HOME/.pi/agent/pi-extensions}"
PROVIDER_USAGE_CLI="${PROVIDER_USAGE_CLI:-$PI_EXTENSIONS_DIR/packages/statusline/src/provider-usage-cli.ts}"
BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
if [[ ! -x "$BUN_BIN" ]]; then
  BUN_BIN="$(command -v bun || true)"
fi
SKETCHYBAR_BIN="${SKETCHYBAR_BIN:-/opt/homebrew/bin/sketchybar}"
if [[ ! -x "$SKETCHYBAR_BIN" ]]; then
  SKETCHYBAR_BIN="$(command -v sketchybar || true)"
fi
AI_USAGE_LOG_PATH="${AI_USAGE_LOG_PATH:-${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar/ai-usage.log}"
AI_USAGE_LOG_LOCK_PATH="${AI_USAGE_LOG_PATH}.lock"

acquire_usage_log_lock() {
  mkdir -p "$(dirname "$AI_USAGE_LOG_PATH")" 2>/dev/null || return 1
  mkdir "$AI_USAGE_LOG_LOCK_PATH" 2>/dev/null
}

release_usage_log_lock() {
  rmdir "$AI_USAGE_LOG_LOCK_PATH" 2>/dev/null || true
}

log_usage_error() {
  local message="$1"
  acquire_usage_log_lock || return 0
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$message" >>"$AI_USAGE_LOG_PATH" 2>/dev/null || true
  trim_usage_log
  release_usage_log_lock
}

trim_usage_log() {
  [[ -f "$AI_USAGE_LOG_PATH" ]] || return 0
  local size
  size="$(wc -c <"$AI_USAGE_LOG_PATH" 2>/dev/null || printf '0')"
  (( size > 65536 )) || return 0
  local temporary_path="${AI_USAGE_LOG_PATH}.$$.tmp"
  tail -c 32768 "$AI_USAGE_LOG_PATH" >"$temporary_path" 2>/dev/null || return 0
  mv "$temporary_path" "$AI_USAGE_LOG_PATH" 2>/dev/null || true
}

append_usage_diagnostics() {
  local diagnostics_path="$1"
  [[ -s "$diagnostics_path" ]] || return 0
  acquire_usage_log_lock || return 0
  cat "$diagnostics_path" >>"$AI_USAGE_LOG_PATH" 2>/dev/null || true
  trim_usage_log
  release_usage_log_lock
}

read_provider_usage() {
  if [[ -n "${PROVIDER_USAGE_FIXTURE_PATH:-}" ]]; then
    cat "$PROVIDER_USAGE_FIXTURE_PATH"
    return "${PROVIDER_USAGE_FIXTURE_EXIT_CODE:-0}"
  fi

  [[ -n "$BUN_BIN" && -f "$PROVIDER_USAGE_CLI" ]] || return 1
  "$BUN_BIN" "$PROVIDER_USAGE_CLI"
}

sync_provider_usage() {
  local text="$1"
  [[ -n "$SKETCHYBAR_BIN" ]] || return 0

  if [[ -n "$text" ]]; then
    "$SKETCHYBAR_BIN" --set ai_usage.providers \
      drawing=on \
      icon.drawing=off \
      label="$text" \
      label.color="$ACCENT_COLOR" \
      --set right_separator.ai drawing=on \
      --move right_separator.ai after ram \
      --move ai_usage.providers after right_separator.ai >/dev/null 2>&1 || true
  else
    "$SKETCHYBAR_BIN" \
      --set ai_usage.providers drawing=off \
      --set right_separator.ai drawing=off >/dev/null 2>&1 || true
  fi
}

main() {
  local diagnostics_path
  diagnostics_path="$(mktemp "${TMPDIR:-/tmp}/sketchybar-ai-usage.XXXXXX" 2>/dev/null || printf '/dev/null')"

  local usage_json
  if ! usage_json="$(read_provider_usage 2>"$diagnostics_path")"; then
    append_usage_diagnostics "$diagnostics_path"
    [[ "$diagnostics_path" == "/dev/null" ]] || rm -f "$diagnostics_path"
    log_usage_error "provider usage CLI failed"
    return 0
  fi
  append_usage_diagnostics "$diagnostics_path"
  [[ "$diagnostics_path" == "/dev/null" ]] || rm -f "$diagnostics_path"

  local text
  if ! text="$(jq -er '.text | select(type == "string")' <<<"$usage_json" 2>/dev/null)"; then
    log_usage_error "provider usage CLI returned invalid JSON"
    return 0
  fi

  sync_provider_usage "$text"
}

main "$@"
