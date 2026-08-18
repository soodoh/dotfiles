#!/usr/bin/env bash
set -euo pipefail

if [[ "${FIREFOXPWA_PLATFORM:-$(uname -s)}" != "Darwin" ]]; then
  exit 0
fi

firefoxpwa_bin="${FIREFOXPWA_BIN:-firefoxpwa}"
userdata_dir="${FFPWA_USERDATA:-$HOME/Library/Application Support/firefoxpwa}"
applications_dir="${FIREFOXPWA_APPLICATIONS_DIR:-$HOME/Applications}"
runtime_executable="$userdata_dir/runtime/Firefox.app/Contents/MacOS/firefox"
app_bundle="$applications_dir/Google Calendar.app"
manifest_url="https://calendar.google.com/calendar/manifest.json"
document_url="https://calendar.google.com/calendar/r"

if [[ -x "$runtime_executable" ]]; then
  "$firefoxpwa_bin" runtime patch
else
  "$firefoxpwa_bin" runtime install
fi

profile_list=$("$firefoxpwa_bin" profile list)
site_line=""
while IFS= read -r line; do
  if [[ "$line" == *": $manifest_url ("* ]]; then
    site_line="$line"
    break
  fi
done <<< "$profile_list"

if [[ -z "$site_line" ]]; then
  "$firefoxpwa_bin" site install "$manifest_url" \
    --document-url "$document_url" \
    --start-url "$document_url" \
    --name "Google Calendar"
elif [[ ! -d "$app_bundle" ]]; then
  site_id="${site_line##* (}"
  site_id="${site_id%)}"
  "$firefoxpwa_bin" site update "$site_id"
fi
