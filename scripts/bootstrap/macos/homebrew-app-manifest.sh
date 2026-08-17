#!/usr/bin/env bash
set -euo pipefail

[[ $# == 1 ]] || {
  printf 'usage: %s personal-macos|work-macos\n' "$0" >&2
  exit 64
}
profile=$1

common_homebrew_casks=(
  'ghostty|ghostty'
  'obsidian|obsidian'
  'lunar|lunar'
  'nextcloud|nextcloud'
  'wispr-flow|wispr-flow'
  'zen|zen'
  'font-fira-code-nerd-font|font-fira-code-nerd-font'
  'aerospace|nikitabobko/tap/aerospace'
)

personal_homebrew_casks=(
  'discord|discord'
  'anki|anki'
  'moonlight|moonlight'
  'google-chrome|google-chrome'
  'slack|slack'
  'zoom|zoom'
  'prusaslicer|prusaslicer'
  'rar|rar'
)

work_homebrew_casks=(
  'gcloud-cli|gcloud-cli'
  'snowflake-cli|snowflakedb/snowflake-cli/snowflake-cli'
)

printf '%s\n' "${common_homebrew_casks[@]}"
case "$profile" in
  personal-macos) printf '%s\n' "${personal_homebrew_casks[@]}" ;;
  work-macos) printf '%s\n' "${work_homebrew_casks[@]}" ;;
  *)
    printf 'error: unsupported Homebrew app profile: %s\n' "$profile" >&2
    exit 64
    ;;
esac
