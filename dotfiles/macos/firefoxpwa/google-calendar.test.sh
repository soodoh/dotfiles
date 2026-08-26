#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
script="$script_dir/google-calendar.sh"
profile_template="$script_dir/profile/user.js"
manifest_url="https://calendar.google.com/calendar/manifest.json"
document_url="https://calendar.google.com/calendar/r"
profile_id="00000000000000000000000000"
site_id="01ARZ3NDEKTSV4RRFFQ69G5FAV"
profile_description="Dedicated Google Calendar web app profile"

test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_log() {
  local expected=$1
  local actual
  actual=$(cat "$FIREFOXPWA_TEST_LOG")
  [[ "$actual" == "$expected" ]] || fail "unexpected command log\nexpected:\n$expected\nactual:\n$actual"
}

assert_codesign_log() {
  local expected=$1
  local actual
  actual=$(cat "$FIREFOXPWA_TEST_CODESIGN_LOG")
  [[ "$actual" == "$expected" ]] || fail "unexpected codesign log\nexpected:\n$expected\nactual:\n$actual"
}

assert_profile_configuration() {
  local profile_dir="$HOME/Library/Application Support/firefoxpwa/profiles/$profile_id"
  cmp -s "$profile_template" "$profile_dir/user.js" || fail "managed user.js was not installed"
  jq -e '."chrome://browser/content/browser.xhtml".TabsToolbar.collapsed == "true"' \
    "$profile_dir/xulstore.json" >/dev/null || fail "icon bar was not configured as collapsed"
}

assert_runtime_icon_configuration() {
  local runtime_bundle="$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app"
  local app_icon="$HOME/Applications/Google Calendar.app/Contents/Resources/app.icns"
  local app_icon_digest="$HOME/Applications/Google Calendar.app/Contents/Resources/app.icns.normalized.sha256"
  local runtime_icon="$runtime_bundle/Contents/Resources/google-calendar.icns"

  cmp -s "$app_icon" "$runtime_icon" || fail "runtime did not receive the Google Calendar icon"
  python3 - "$app_icon" "$app_icon_digest" <<'PY'
import hashlib
import sys
from pathlib import Path

icon_path = Path(sys.argv[1])
digest_path = Path(sys.argv[2])
if digest_path.read_text(encoding="utf-8").strip() != hashlib.sha256(icon_path.read_bytes()).hexdigest():
    raise SystemExit(1)
PY
  python3 - "$runtime_bundle/Contents/Info.plist" <<'PY'
import plistlib
import sys
from pathlib import Path

with Path(sys.argv[1]).open("rb") as source:
    info = plistlib.load(source)

if info.get("CFBundleIconFile") != "google-calendar.icns" or "CFBundleIconName" in info:
    raise SystemExit(1)
PY
}

create_runtime_fixture() {
  local runtime_bundle="$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app"
  mkdir -p "$runtime_bundle/Contents/MacOS" "$runtime_bundle/Contents/Resources"
  : > "$runtime_bundle/Contents/MacOS/firefox"
  chmod +x "$runtime_bundle/Contents/MacOS/firefox"
  printf 'firefox icon\n' > "$runtime_bundle/Contents/Resources/firefox.icns"
  cat > "$runtime_bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIconFile</key><string>firefox.icns</string>
<key>CFBundleIconName</key><string>AppIcon</string>
</dict></plist>
PLIST
}

create_app_fixture() {
  local app_resources="$HOME/Applications/Google Calendar.app/Contents/Resources"
  mkdir -p "$app_resources"
  printf 'google calendar icon\n' > "$app_resources/app.icns"
}

mark_app_icon_normalized_fixture() {
  local app_resources="$HOME/Applications/Google Calendar.app/Contents/Resources"
  python3 - "$app_resources/app.icns" "$app_resources/app.icns.normalized.sha256" <<'PY'
import hashlib
import sys
from pathlib import Path

icon_path = Path(sys.argv[1])
digest_path = Path(sys.argv[2])
digest_path.write_text(f"{hashlib.sha256(icon_path.read_bytes()).hexdigest()}\n", encoding="utf-8")
PY
}

configure_runtime_icon_fixture() {
  local runtime_bundle="$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app"
  cp "$HOME/Applications/Google Calendar.app/Contents/Resources/app.icns" \
    "$runtime_bundle/Contents/Resources/google-calendar.icns"
  python3 - "$runtime_bundle/Contents/Info.plist" <<'PY'
import plistlib
import sys
from pathlib import Path

path = Path(sys.argv[1])
with path.open("rb") as source:
    info = plistlib.load(source)
info["CFBundleIconFile"] = "google-calendar.icns"
info.pop("CFBundleIconName", None)
with path.open("wb") as target:
    plistlib.dump(info, target)
PY
}

setup_case() {
  local name=$1
  export HOME="$test_root/$name/home"
  export FIREFOXPWA_TEST_LOG="$test_root/$name/commands.log"
  export FIREFOXPWA_TEST_CODESIGN_LOG="$test_root/$name/codesign.log"
  export FIREFOXPWA_TEST_PROFILE_LIST="$test_root/$name/profile-list.txt"
  export FIREFOXPWA_PLATFORM="Darwin"
  export FIREFOXPWA_BIN="$test_root/firefoxpwa"
  export FIREFOXPWA_CODESIGN_BIN="$test_root/codesign"
  export FIREFOXPWA_ICONUTIL_BIN="$test_root/iconutil"
  export FIREFOXPWA_LSOF_BIN="lsof"
  export FIREFOXPWA_SIPS_BIN="$test_root/sips"
  mkdir -p "$HOME" "$(dirname "$FIREFOXPWA_TEST_LOG")"
  : > "$FIREFOXPWA_TEST_LOG"
  : > "$FIREFOXPWA_TEST_CODESIGN_LOG"
  cat > "$FIREFOXPWA_TEST_PROFILE_LIST" <<PROFILE
===================== Default =====================
Description: Default profile for all web apps
ID: $profile_id
PROFILE
}

setup_current_state() {
  local profile_dir="$HOME/Library/Application Support/firefoxpwa/profiles/$profile_id"

  create_runtime_fixture
  create_app_fixture
  mark_app_icon_normalized_fixture
  configure_runtime_icon_fixture
  mkdir -p "$profile_dir"
  install -m 0644 "$profile_template" "$profile_dir/user.js"
  cat > "$profile_dir/xulstore.json" <<'JSON'
{"chrome://browser/content/browser.xhtml":{"TabsToolbar":{"collapsed":"true"}}}
JSON
  cat > "$FIREFOXPWA_TEST_PROFILE_LIST" <<PROFILE
===================== Google Calendar ======================
Description: $profile_description
ID: $profile_id

Apps:
- Google Calendar: $manifest_url ($site_id)
PROFILE
}

mark_profile_running() {
  local profile_dir="$HOME/Library/Application Support/firefoxpwa/profiles/$profile_id"

  : > "$profile_dir/.parentlock"
  cat > "$test_root/lsof" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
  chmod +x "$test_root/lsof"
  export FIREFOXPWA_LSOF_BIN="$test_root/lsof"
}

cat > "$test_root/firefoxpwa" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FIREFOXPWA_TEST_LOG"
case "$1 $2" in
  "runtime install")
    runtime_bundle="$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app"
    mkdir -p "$runtime_bundle/Contents/MacOS" "$runtime_bundle/Contents/Resources"
    : > "$runtime_bundle/Contents/MacOS/firefox"
    chmod +x "$runtime_bundle/Contents/MacOS/firefox"
    printf 'firefox icon\n' > "$runtime_bundle/Contents/Resources/firefox.icns"
    cat > "$runtime_bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIconFile</key><string>firefox.icns</string>
<key>CFBundleIconName</key><string>AppIcon</string>
</dict></plist>
PLIST
    ;;
  "profile list")
    cat "$FIREFOXPWA_TEST_PROFILE_LIST"
    ;;
  "site install"|"site update")
    app_resources="$HOME/Applications/Google Calendar.app/Contents/Resources"
    mkdir -p "$app_resources"
    printf 'google calendar icon\n' > "$app_resources/app.icns"
    ;;
esac
FAKE
chmod +x "$test_root/firefoxpwa"

cat > "$test_root/codesign" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIREFOXPWA_TEST_CODESIGN_LOG"
FAKE
chmod +x "$test_root/codesign"

cat > "$test_root/sips" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
input=""
output=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --out)
      output=$2
      shift 2
      ;;
    -s)
      shift 3
      ;;
    -z)
      shift 3
      ;;
    *)
      [[ -f "$1" ]] && input=$1
      shift
      ;;
  esac
done
cp "$input" "$output"
FAKE
chmod +x "$test_root/sips"

cat > "$test_root/iconutil" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
output=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then
    output=$2
    break
  fi
  shift
done
printf 'normalized google calendar icon\n' > "$output"
FAKE
chmod +x "$test_root/iconutil"

setup_case fresh
bash "$script"
assert_log "profile list
runtime install
profile update $profile_id --name Google Calendar --description $profile_description
site install $manifest_url --profile $profile_id --document-url $document_url --start-url $document_url --name Google Calendar"
assert_codesign_log "--remove-signature $HOME/Applications/Google Calendar.app
-s - $HOME/Applications/Google Calendar.app
--remove-signature $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app
-s - $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app"
assert_profile_configuration
assert_runtime_icon_configuration

setup_case current
setup_current_state
bash "$script"
assert_log "profile list"
assert_codesign_log ""
assert_profile_configuration
assert_runtime_icon_configuration

setup_case current-running
setup_current_state
mark_profile_running
bash "$script"
assert_log "profile list"
assert_codesign_log ""
assert_profile_configuration
assert_runtime_icon_configuration

setup_case malformed-icon
setup_current_state
printf 'malformed small icon representations\n' > "$HOME/Applications/Google Calendar.app/Contents/Resources/app.icns"
bash "$script"
assert_log "profile list
runtime patch
profile update $profile_id --name Google Calendar --description $profile_description"
assert_codesign_log "--remove-signature $HOME/Applications/Google Calendar.app
-s - $HOME/Applications/Google Calendar.app
--remove-signature $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app
-s - $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app"
assert_profile_configuration
assert_runtime_icon_configuration
setup_case icon-drift
setup_current_state
rm "$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app/Contents/Resources/google-calendar.icns"
bash "$script"
assert_log "profile list
runtime patch
profile update $profile_id --name Google Calendar --description $profile_description"
assert_codesign_log "--remove-signature $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app
-s - $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app"
assert_profile_configuration
assert_runtime_icon_configuration

setup_case existing
profile_dir="$HOME/Library/Application Support/firefoxpwa/profiles/$profile_id"
create_runtime_fixture
create_app_fixture
mkdir -p "$profile_dir"
cat > "$profile_dir/xulstore.json" <<'JSON'
{"chrome://browser/content/browser.xhtml":{"main-window":{"width":"1200"}}}
JSON
cat >> "$FIREFOXPWA_TEST_PROFILE_LIST" <<PROFILE

Apps:
- Google Calendar: $manifest_url ($site_id)
PROFILE
bash "$script"
assert_log "profile list
runtime patch
profile update $profile_id --name Google Calendar --description $profile_description"
assert_codesign_log "--remove-signature $HOME/Applications/Google Calendar.app
-s - $HOME/Applications/Google Calendar.app
--remove-signature $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app
-s - $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app"
assert_profile_configuration
assert_runtime_icon_configuration
jq -e '."chrome://browser/content/browser.xhtml"."main-window".width == "1200"' \
  "$profile_dir/xulstore.json" >/dev/null || fail "existing XUL state was not preserved"

setup_case repair
create_runtime_fixture
cat >> "$FIREFOXPWA_TEST_PROFILE_LIST" <<PROFILE

Apps:
- Google Calendar: $manifest_url ($site_id)
PROFILE
bash "$script"
assert_log "profile list
runtime patch
profile update $profile_id --name Google Calendar --description $profile_description
site update $site_id"
assert_codesign_log "--remove-signature $HOME/Applications/Google Calendar.app
-s - $HOME/Applications/Google Calendar.app
--remove-signature $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app
-s - $HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app"
assert_profile_configuration
assert_runtime_icon_configuration

setup_case drifted-running
profile_dir="$HOME/Library/Application Support/firefoxpwa/profiles/$profile_id"
mkdir -p "$profile_dir"
mark_profile_running
set +e
bash "$script" >/dev/null 2>&1
status=$?
set -e
[[ "$status" -eq 75 ]] || fail "drifted running profile should fail with status 75"
assert_log "profile list"
assert_codesign_log ""

setup_case linux
export FIREFOXPWA_PLATFORM="Linux"
bash "$script"
[[ ! -s "$FIREFOXPWA_TEST_LOG" ]] || fail "non-macOS execution should be a no-op"
[[ ! -s "$FIREFOXPWA_TEST_CODESIGN_LOG" ]] || fail "non-macOS execution should not sign the runtime"

printf 'PASS: FirefoxPWA Google Calendar bootstrap\n'
