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
  local usage_json
  if ! usage_json="$(read_provider_usage 2>/dev/null)"; then
    return 0
  fi
  local text
  text="$(jq -er '.text | select(type == "string")' <<<"$usage_json" 2>/dev/null)" || return 0
  sync_provider_usage "$text"
}

main "$@"
