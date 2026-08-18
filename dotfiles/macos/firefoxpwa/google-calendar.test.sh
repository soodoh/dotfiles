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

assert_profile_configuration() {
  local profile_dir="$HOME/Library/Application Support/firefoxpwa/profiles/$profile_id"
  cmp -s "$profile_template" "$profile_dir/user.js" || fail "managed user.js was not installed"
  jq -e '."chrome://browser/content/browser.xhtml".TabsToolbar.collapsed == "true"' \
    "$profile_dir/xulstore.json" >/dev/null || fail "icon bar was not configured as collapsed"
}

setup_case() {
  local name=$1
  export HOME="$test_root/$name/home"
  export FIREFOXPWA_TEST_LOG="$test_root/$name/commands.log"
  export FIREFOXPWA_TEST_PROFILE_LIST="$test_root/$name/profile-list.txt"
  export FIREFOXPWA_PLATFORM="Darwin"
  export FIREFOXPWA_BIN="$test_root/firefoxpwa"
  export FIREFOXPWA_LSOF_BIN="lsof"
  mkdir -p "$HOME" "$(dirname "$FIREFOXPWA_TEST_LOG")"
  : > "$FIREFOXPWA_TEST_LOG"
  cat > "$FIREFOXPWA_TEST_PROFILE_LIST" <<PROFILE
===================== Default =====================
Description: Default profile for all web apps
ID: $profile_id
PROFILE
}

cat > "$test_root/firefoxpwa" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FIREFOXPWA_TEST_LOG"
case "$1 $2" in
  "runtime install")
    runtime="$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app/Contents/MacOS/firefox"
    mkdir -p "$(dirname "$runtime")"
    : > "$runtime"
    chmod +x "$runtime"
    ;;
  "profile list")
    cat "$FIREFOXPWA_TEST_PROFILE_LIST"
    ;;
  "site install")
    mkdir -p "$HOME/Applications/Google Calendar.app"
    ;;
esac
FAKE
chmod +x "$test_root/firefoxpwa"

setup_case fresh
bash "$script"
assert_log "profile list
runtime install
profile update $profile_id --name Google Calendar --description $profile_description
site install $manifest_url --profile $profile_id --document-url $document_url --start-url $document_url --name Google Calendar"
assert_profile_configuration

setup_case existing
runtime="$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app/Contents/MacOS/firefox"
profile_dir="$HOME/Library/Application Support/firefoxpwa/profiles/$profile_id"
mkdir -p "$(dirname "$runtime")" "$HOME/Applications/Google Calendar.app" "$profile_dir"
: > "$runtime"
chmod +x "$runtime"
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
assert_profile_configuration
jq -e '."chrome://browser/content/browser.xhtml"."main-window".width == "1200"' \
  "$profile_dir/xulstore.json" >/dev/null || fail "existing XUL state was not preserved"

setup_case repair
runtime="$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app/Contents/MacOS/firefox"
mkdir -p "$(dirname "$runtime")"
: > "$runtime"
chmod +x "$runtime"
cat >> "$FIREFOXPWA_TEST_PROFILE_LIST" <<PROFILE

Apps:
- Google Calendar: $manifest_url ($site_id)
PROFILE
bash "$script"
assert_log "profile list
runtime patch
profile update $profile_id --name Google Calendar --description $profile_description
site update $site_id"
assert_profile_configuration

setup_case running
profile_dir="$HOME/Library/Application Support/firefoxpwa/profiles/$profile_id"
mkdir -p "$profile_dir"
: > "$profile_dir/.parentlock"
cat > "$test_root/lsof" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
chmod +x "$test_root/lsof"
export FIREFOXPWA_LSOF_BIN="$test_root/lsof"
set +e
bash "$script" >/dev/null 2>&1
status=$?
set -e
[[ "$status" -eq 75 ]] || fail "running profile should fail with status 75"
assert_log "profile list"

setup_case linux
export FIREFOXPWA_PLATFORM="Linux"
bash "$script"
[[ ! -s "$FIREFOXPWA_TEST_LOG" ]] || fail "non-macOS execution should be a no-op"

printf 'PASS: FirefoxPWA Google Calendar bootstrap\n'
