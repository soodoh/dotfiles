#!/usr/bin/env bash
set -euo pipefail

if [[ "${FIREFOXPWA_PLATFORM:-$(uname -s)}" != "Darwin" ]]; then
  exit 0
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
firefoxpwa_bin="${FIREFOXPWA_BIN:-firefoxpwa}"
codesign_bin="${FIREFOXPWA_CODESIGN_BIN:-codesign}"
iconutil_bin="${FIREFOXPWA_ICONUTIL_BIN:-iconutil}"
lsof_bin="${FIREFOXPWA_LSOF_BIN:-lsof}"
python_bin="${FIREFOXPWA_PYTHON_BIN:-python3}"
sips_bin="${FIREFOXPWA_SIPS_BIN:-sips}"
userdata_dir="${FFPWA_USERDATA:-$HOME/Library/Application Support/firefoxpwa}"
applications_dir="${FIREFOXPWA_APPLICATIONS_DIR:-$HOME/Applications}"
runtime_bundle="$userdata_dir/runtime/Firefox.app"
runtime_executable="$runtime_bundle/Contents/MacOS/firefox"
runtime_info_plist="$runtime_bundle/Contents/Info.plist"
runtime_icon="$runtime_bundle/Contents/Resources/google-calendar.icns"
app_bundle="$applications_dir/Google Calendar.app"
app_icon="$app_bundle/Contents/Resources/app.icns"
app_icon_digest="$app_bundle/Contents/Resources/app.icns.normalized.sha256"
profile_template="$script_dir/profile/user.js"
default_profile_id="00000000000000000000000000"
manifest_url="https://calendar.google.com/calendar/manifest.json"
document_url="https://calendar.google.com/calendar/r"
icon_work_dir=""

cleanup_icon_work_dir() {
  [[ -z "$icon_work_dir" ]] || rm -rf "$icon_work_dir"
}
trap cleanup_icon_work_dir EXIT

app_icon_is_normalized() {
  [[ -f "$app_icon" && -f "$app_icon_digest" ]] \
    && "$python_bin" - "$app_icon" "$app_icon_digest" <<'PY'
import hashlib
import sys
from pathlib import Path

icon_path = Path(sys.argv[1])
digest_path = Path(sys.argv[2])
expected = digest_path.read_text(encoding="utf-8").strip()
actual = hashlib.sha256(icon_path.read_bytes()).hexdigest()
raise SystemExit(expected != actual)
PY
}

write_app_icon_digest() {
  "$python_bin" - "$app_icon" "$app_icon_digest" <<'PY'
import hashlib
import os
import sys
import tempfile
from pathlib import Path

icon_path = Path(sys.argv[1])
digest_path = Path(sys.argv[2])
digest = hashlib.sha256(icon_path.read_bytes()).hexdigest()

with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=digest_path.parent, delete=False) as target:
    target.write(f"{digest}\n")
    temporary_path = target.name
os.replace(temporary_path, digest_path)
PY
}

normalize_app_icon() {
  local work_dir
  local source_png
  local iconset_dir
  local normalized_icon
  local icon_spec
  local icon_size
  local icon_name

  work_dir=$(mktemp -d "${TMPDIR:-/tmp}/google-calendar-icon.XXXXXX")
  icon_work_dir="$work_dir"
  source_png="$work_dir/source.png"
  iconset_dir="$work_dir/Google Calendar.iconset"
  normalized_icon="$work_dir/Google Calendar.icns"
  mkdir -p "$iconset_dir"

  # FirefoxPWA's ICNS can contain corrupt legacy-size entries, so rebuild every
  # representation from the valid largest image selected by sips.
  "$sips_bin" -s format png "$app_icon" --out "$source_png" >/dev/null
  for icon_spec in \
    "16 icon_16x16.png" \
    "32 icon_16x16@2x.png" \
    "32 icon_32x32.png" \
    "64 icon_32x32@2x.png" \
    "128 icon_128x128.png" \
    "256 icon_128x128@2x.png" \
    "256 icon_256x256.png" \
    "512 icon_256x256@2x.png" \
    "512 icon_512x512.png" \
    "1024 icon_512x512@2x.png"; do
    read -r icon_size icon_name <<< "$icon_spec"
    "$sips_bin" -z "$icon_size" "$icon_size" "$source_png" \
      --out "$iconset_dir/$icon_name" >/dev/null
  done
  "$iconutil_bin" -c icns "$iconset_dir" -o "$normalized_icon"
  install -m 0644 "$normalized_icon" "$app_icon"
  write_app_icon_digest
  rm -rf "$work_dir"
  icon_work_dir=""

  # Replacing resources invalidates the FirefoxPWA launcher signature.
  "$codesign_bin" --remove-signature "$app_bundle"
  "$codesign_bin" -s - "$app_bundle"
  touch "$app_bundle"
}

runtime_icon_is_configured() {
  app_icon_is_normalized \
    && [[ -f "$runtime_icon" && -f "$runtime_info_plist" ]] \
    && cmp -s "$app_icon" "$runtime_icon" \
    && "$python_bin" - "$runtime_info_plist" <<'PY'
import plistlib
import sys
from pathlib import Path

with Path(sys.argv[1]).open("rb") as source:
    info = plistlib.load(source)

raise SystemExit(
    info.get("CFBundleIconFile") != "google-calendar.icns"
    or "CFBundleIconName" in info
)
PY
}

profile_list=$("$firefoxpwa_bin" profile list)
current_profile_id=""
current_profile_name=""
current_profile_description=""
profile_id="$default_profile_id"
profile_name=""
profile_description=""
site_line=""
while IFS= read -r line; do
  if [[ "$line" =~ ^={3,}\ (.*)\ ={3,}$ ]]; then
    current_profile_name="${BASH_REMATCH[1]}"
  elif [[ "$line" == "Description: "* ]]; then
    current_profile_description="${line#Description: }"
  elif [[ "$line" == "ID: "* ]]; then
    current_profile_id="${line#ID: }"
  elif [[ "$line" == *": $manifest_url ("* ]]; then
    site_line="$line"
    profile_id="${current_profile_id:-$default_profile_id}"
    profile_name="$current_profile_name"
    profile_description="$current_profile_description"
    break
  fi
done <<< "$profile_list"

profile_dir="$userdata_dir/profiles/$profile_id"
profile_lock="$profile_dir/.parentlock"
if [[ -x "$runtime_executable" \
  && -n "$site_line" \
  && -d "$app_bundle" \
  && "$profile_name" == "Google Calendar" \
  && "$profile_description" == "Dedicated Google Calendar web app profile" \
  && -f "$profile_dir/user.js" ]] \
  && cmp -s "$profile_template" "$profile_dir/user.js" \
  && jq -e '."chrome://browser/content/browser.xhtml".TabsToolbar.collapsed == "true"' \
    "$profile_dir/xulstore.json" >/dev/null 2>&1 \
  && runtime_icon_is_configured; then
  exit 0
fi

if [[ -f "$profile_lock" ]] && "$lsof_bin" "$profile_lock" >/dev/null 2>&1; then
  printf 'error: close Google Calendar before configuring its FirefoxPWA profile\n' >&2
  exit 75
fi

if [[ -x "$runtime_executable" ]]; then
  "$firefoxpwa_bin" runtime patch
else
  "$firefoxpwa_bin" runtime install
fi

"$firefoxpwa_bin" profile update "$profile_id" \
  --name "Google Calendar" \
  --description "Dedicated Google Calendar web app profile"

mkdir -p "$profile_dir"
install -m 0644 "$profile_template" "$profile_dir/user.js"
"$python_bin" - "$profile_dir/xulstore.json" <<'PY'
import json
import os
import sys
import tempfile
from pathlib import Path

path = Path(sys.argv[1])
data = {}
if path.exists() and path.stat().st_size:
    with path.open(encoding="utf-8") as source:
        data = json.load(source)

browser = data.setdefault("chrome://browser/content/browser.xhtml", {})
browser.setdefault("TabsToolbar", {})["collapsed"] = "true"

path.parent.mkdir(parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as target:
    json.dump(data, target, separators=(",", ":"))
    target.write("\n")
    temporary_path = target.name
os.replace(temporary_path, path)
PY

if [[ -z "$site_line" ]]; then
  "$firefoxpwa_bin" site install "$manifest_url" \
    --profile "$profile_id" \
    --document-url "$document_url" \
    --start-url "$document_url" \
    --name "Google Calendar"
elif [[ ! -d "$app_bundle" ]]; then
  site_id="${site_line##* (}"
  site_id="${site_id%)}"
  "$firefoxpwa_bin" site update "$site_id"
fi

if [[ ! -f "$app_icon" ]]; then
  printf 'error: Google Calendar app icon was not created at %s\n' "$app_icon" >&2
  exit 1
fi

if ! app_icon_is_normalized; then
  normalize_app_icon
fi

install -m 0644 "$app_icon" "$runtime_icon"
"$python_bin" - "$runtime_info_plist" <<'PY'
import os
import plistlib
import sys
import tempfile
from pathlib import Path

path = Path(sys.argv[1])
with path.open("rb") as source:
    info = plistlib.load(source)

info["CFBundleIconFile"] = "google-calendar.icns"
info.pop("CFBundleIconName", None)

with tempfile.NamedTemporaryFile("wb", dir=path.parent, delete=False) as target:
    plistlib.dump(info, target)
    temporary_path = target.name
os.replace(temporary_path, path)
PY

# The runtime is the process bundle shown by Force Quit and queried by SketchyBar.
# Re-sign it after installing the site icon because FirefoxPWA modifies this bundle.
"$codesign_bin" --remove-signature "$runtime_bundle"
"$codesign_bin" -s - "$runtime_bundle"
touch "$runtime_bundle"
