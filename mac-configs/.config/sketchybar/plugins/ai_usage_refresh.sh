#!/bin/sh
if [ -z "${BASH_VERSION:-}" ] || shopt -oq posix; then
  exec /bin/bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/colors.sh"
ICON_SCRIPT="$SCRIPT_DIR/ai_usage_icons.sh"

CACHE_DIR="${CACHE_DIR:-${AI_USAGE_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar}}"
AI_USAGE_CACHE_PATH="${AI_USAGE_CACHE_PATH:-$CACHE_DIR/ai_usage.json}"
AI_USAGE_STATE_PATH="${AI_USAGE_STATE_PATH:-$CACHE_DIR/ai_usage_items.txt}"
AI_USAGE_NOW_EPOCH="${AI_USAGE_NOW_EPOCH:-$(date +%s)}"
CODEXBAR_BIN="${CODEXBAR_BIN:-$(command -v codexbar || true)}"
SKETCHYBAR_BIN="${SKETCHYBAR_BIN:-$(command -v sketchybar || true)}"
AI_USAGE_TEXT_FONT="${AI_USAGE_TEXT_FONT:-FiraCode Nerd Font:Bold:14.0}"

mkdir -p "$(dirname "$AI_USAGE_CACHE_PATH")" "$(dirname "$AI_USAGE_STATE_PATH")"

read_codexbar_output() {
  if [[ -n "${CODEXBAR_FIXTURE_PATH:-}" ]]; then
    cat "$CODEXBAR_FIXTURE_PATH"
    return "${CODEXBAR_FIXTURE_EXIT_CODE:-0}"
  fi

  "$CODEXBAR_BIN" usage --format json
}

write_cache() {
  local cache_payload="$1"
  local cache_dir
  local cache_base
  local cache_tmp_path

  cache_dir="$(dirname "$AI_USAGE_CACHE_PATH")"
  cache_base="$(basename "$AI_USAGE_CACHE_PATH")"
  cache_tmp_path="$(mktemp "$cache_dir/${cache_base}.XXXXXX")"

  printf '%s\n' "$cache_payload" > "$cache_tmp_path"
  mv "$cache_tmp_path" "$AI_USAGE_CACHE_PATH"
}

resolve_icon_path() {
  local icon_path="$1"

  if [[ -z "$icon_path" ]]; then
    printf '\n'
    return 0
  fi

  if [[ "$icon_path" == /* ]]; then
    printf '%s\n' "$icon_path"
  else
    printf '%s/%s\n' "$SCRIPT_DIR" "$icon_path"
  fi
}

render_provider_item() {
  local item_name="$1"
  local provider_name="$2"
  local resolved_icon_path="$3"
  local session_used="$4"
  local label_color="$5"

  if [[ -n "$resolved_icon_path" ]]; then
    "$SKETCHYBAR_BIN" \
      --set "$item_name" \
      drawing=on \
      icon="" \
      icon.background.drawing=on \
      icon.background.color=0x00000000 \
      icon.background.image="$resolved_icon_path" \
      icon.background.image.drawing=on \
      icon.background.image.scale=0.5 \
      label="${session_used}%" \
      label.color="$label_color" >/dev/null 2>&1 || true
    return 0
  fi

  "$SKETCHYBAR_BIN" \
    --set "$item_name" \
    drawing=on \
    icon="$provider_name" \
    icon.font="$AI_USAGE_TEXT_FONT" \
    icon.color="$label_color" \
    icon.background.drawing=off \
    icon.background.image="" \
    icon.background.image.drawing=off \
    label="${session_used}%" \
    label.color="$label_color" >/dev/null 2>&1 || true
}

sync_ai_separator() {
  if [[ -z "$SKETCHYBAR_BIN" ]]; then
    return 0
  fi

  local has_providers="$1"

  if [[ "$has_providers" == "true" ]]; then
    "$SKETCHYBAR_BIN" \
      --set right_separator.ai \
      drawing=on \
      icon=│ \
      label.drawing=off \
      icon.color=0x66ffffff \
      icon.padding_left=6 \
      icon.padding_right=6 \
      background.drawing=off >/dev/null 2>&1 || true
    return 0
  fi

  "$SKETCHYBAR_BIN" --set right_separator.ai drawing=off >/dev/null 2>&1 || true
}

with_ai_usage_state_lock() {
  local lock_dir="${AI_USAGE_STATE_PATH}.lock"

  while ! mkdir "$lock_dir" 2>/dev/null; do
    sleep 0.05
  done

  "$@"
  local command_status=$?
  rmdir "$lock_dir"
  return "$command_status"
}

sync_provider_items_unlocked() {
  if [[ -z "$SKETCHYBAR_BIN" ]]; then
    return 0
  fi

  local previous_provider_ids=""
  if [[ -f "$AI_USAGE_STATE_PATH" ]]; then
    previous_provider_ids="$(cat "$AI_USAGE_STATE_PATH")"
  fi

  if [[ -n "${AI_USAGE_STATE_SYNC_SIGNAL_PATH:-}" ]]; then
    : > "$AI_USAGE_STATE_SYNC_SIGNAL_PATH"
  fi
  if [[ -n "${AI_USAGE_STATE_SYNC_WAIT_PATH:-}" ]]; then
    while [[ -e "$AI_USAGE_STATE_SYNC_WAIT_PATH" ]]; do
      sleep 0.05
    done
  fi

  local stale_cache
  stale_cache="$(jq -r '.stale' "$AI_USAGE_CACHE_PATH")"
  local -a current_provider_ids=()
  local -a render_args=()
  local provider_id
  while IFS= read -r provider_json; do
    [[ -n "$provider_json" ]] || continue

    provider_id="$(jq -r '.id' <<<"$provider_json")"
    current_provider_ids+=("$provider_id")
    local item_name="ai_usage.$provider_id"
    local icon_path
    icon_path="$(jq -r '.icon' <<<"$provider_json")"
    local resolved_icon_path
    resolved_icon_path="$(resolve_icon_path "$icon_path")"
    local session_used
    session_used="$(jq -r '.sessionUsedPercent' <<<"$provider_json")"
    local label_color="$ACCENT_COLOR"
    if [[ "$stale_cache" == "true" ]]; then
      label_color="$DIMMED_COLOR"
    fi

    "$SKETCHYBAR_BIN" --add item "ai_usage.$provider_id" right >/dev/null 2>&1 || true
    render_args+=(
      --set "$item_name"
      drawing=on
      label="${session_used}%"
      label.color="$label_color"
    )

    if [[ -n "$resolved_icon_path" ]]; then
      render_args+=(
        icon=""
        icon.background.drawing=on
        icon.background.color=0x00000000
        icon.background.image="$resolved_icon_path"
        icon.background.image.drawing=on
        icon.background.image.scale=0.5
      )
    else
      render_args+=(
        icon="$provider_id"
        icon.font="$AI_USAGE_TEXT_FONT"
        icon.color="$label_color"
        icon.background.drawing=off
        icon.background.image=""
        icon.background.image.drawing=off
      )
    fi
  done < <(jq -c '.providers[]' "$AI_USAGE_CACHE_PATH")

  if [[ ${#render_args[@]} -gt 0 ]]; then
    if ! "$SKETCHYBAR_BIN" "${render_args[@]}" >/dev/null 2>&1; then
      if [[ ${#current_provider_ids[@]} -gt 0 ]]; then
        local fallback_provider_id
        for fallback_provider_id in "${current_provider_ids[@]}"; do
          local fallback_item_name="ai_usage.$fallback_provider_id"
          local fallback_icon_path
          fallback_icon_path="$(jq -r --arg provider_id "$fallback_provider_id" '.providers[] | select(.id == $provider_id) | .icon' "$AI_USAGE_CACHE_PATH")"
          local fallback_resolved_icon_path
          fallback_resolved_icon_path="$(resolve_icon_path "$fallback_icon_path")"
          local fallback_session_used
          fallback_session_used="$(jq -r --arg provider_id "$fallback_provider_id" '.providers[] | select(.id == $provider_id) | .sessionUsedPercent' "$AI_USAGE_CACHE_PATH")"
          local fallback_label_color="$ACCENT_COLOR"
          if [[ "$stale_cache" == "true" ]]; then
            fallback_label_color="$DIMMED_COLOR"
          fi

          render_provider_item "$fallback_item_name" "$fallback_provider_id" "$fallback_resolved_icon_path" "$fallback_session_used" "$fallback_label_color"
        done
      fi
    fi
  fi

  local current_provider_ids_text=""
  if [[ ${#current_provider_ids[@]} -gt 0 ]]; then
    current_provider_ids_text="$(printf '%s\n' "${current_provider_ids[@]}")"
  fi

  if [[ ${#current_provider_ids[@]} -gt 0 ]]; then
    sync_ai_separator true
    "$SKETCHYBAR_BIN" --move right_separator.ai after ram >/dev/null 2>&1 || true
    local reverse_index
    for (( reverse_index=${#current_provider_ids[@]}-1; reverse_index>=0; reverse_index-- )); do
      provider_id="${current_provider_ids[$reverse_index]}"
      "$SKETCHYBAR_BIN" --move "ai_usage.$provider_id" after right_separator.ai >/dev/null 2>&1 || true
    done
  else
    sync_ai_separator false
  fi

  while IFS= read -r provider_id; do
    [[ -n "$provider_id" ]] || continue

    if [[ -z "$current_provider_ids_text" ]] || ! printf '%s\n' "$current_provider_ids_text" | grep -Fxq "$provider_id"; then
      "$SKETCHYBAR_BIN" --set "ai_usage.$provider_id" drawing=off >/dev/null 2>&1 || true
    fi
  done <<< "$previous_provider_ids"

  : > "$AI_USAGE_STATE_PATH"
  if [[ ${#current_provider_ids[@]} -gt 0 ]]; then
    printf '%s\n' "${current_provider_ids[@]}" > "$AI_USAGE_STATE_PATH"
  fi
}

sync_provider_items() {
  with_ai_usage_state_lock sync_provider_items_unlocked
}

main() {
  local raw_json=""
  raw_json="$(read_codexbar_output 2>/dev/null)" || true

  if [[ -n "$raw_json" ]] && jq -e 'type == "array"' >/dev/null 2>&1 <<<"$raw_json"; then
    local generated_at
    generated_at="$(date -ur "$AI_USAGE_NOW_EPOCH" +"%Y-%m-%dT%H:%M:%SZ")"

    local providers_json
    providers_json="$(
      printf '%s\n' "$raw_json" |
        jq -c '.[] | select((has("error") | not) and (.usage.primary.usedPercent != null))' |
        jq -nc '
          def rounded_percent:
            if type == "number" then
              ((. * 10 | round) / 10 | if . == floor then floor else . end)
            else
              .
            end;

          [inputs
           | {
               id: .provider,
               order: (input_line_number - 1),
               icon: "",
               source: .source,
               loginMethod: (.usage.loginMethod // .usage.identity.loginMethod // ""),
               sessionUsedPercent: (.usage.primary.usedPercent | rounded_percent),
               weeklyUsedPercent: (.usage.secondary.usedPercent // null | rounded_percent),
               sessionResetDescription: (.usage.primary.resetDescription // ""),
               weeklyResetDescription: (.usage.secondary.resetDescription // ""),
               updatedAt: (.usage.updatedAt // "")
             }
          ]'
    )"

    local cache_json
    cache_json="$(
      jq -n \
        --arg generated_at "$generated_at" \
        --argjson providers "$providers_json" \
        '{generatedAt: $generated_at, stale: false, providers: $providers}'
    )"

    local provider_id
    while IFS= read -r provider_id; do
      local icon
      icon="$("$ICON_SCRIPT" "$provider_id")"
      cache_json="$(
        printf '%s\n' "$cache_json" |
          jq --arg provider_id "$provider_id" --arg icon "$icon" \
            '(.providers[] | select(.id == $provider_id) | .icon) = $icon'
      )"
    done < <(printf '%s\n' "$cache_json" | jq -r '.providers[].id')

    write_cache "$cache_json"
    sync_provider_items
    exit 0
  fi

  if [[ -f "$AI_USAGE_CACHE_PATH" ]]; then
    local stale_cache=""
    if stale_cache="$(jq '.stale = true' "$AI_USAGE_CACHE_PATH" 2>/dev/null)"; then
      write_cache "$stale_cache"
    else
      write_cache '{"generatedAt":"","stale":true,"providers":[]}'
    fi
    sync_provider_items
    exit 0
  fi

  write_cache '{"generatedAt":"","stale":true,"providers":[]}'
  sync_provider_items
  exit 0
}

main "$@"
