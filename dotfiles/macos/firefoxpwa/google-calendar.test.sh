#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
script="$script_dir/google-calendar.sh"
manifest_url="https://calendar.google.com/calendar/manifest.json"
document_url="https://calendar.google.com/calendar/r"
site_id="01ARZ3NDEKTSV4RRFFQ69G5FAV"

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

setup_case() {
  local name=$1
  export HOME="$test_root/$name/home"
  export FIREFOXPWA_TEST_LOG="$test_root/$name/commands.log"
  export FIREFOXPWA_TEST_PROFILE_LIST="$test_root/$name/profile-list.txt"
  export FIREFOXPWA_PLATFORM="Darwin"
  export FIREFOXPWA_BIN="$test_root/firefoxpwa"
  mkdir -p "$HOME" "$(dirname "$FIREFOXPWA_TEST_LOG")"
  : > "$FIREFOXPWA_TEST_LOG"
  : > "$FIREFOXPWA_TEST_PROFILE_LIST"
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
assert_log "runtime install
profile list
site install $manifest_url --document-url $document_url --start-url $document_url --name Google Calendar"

setup_case existing
runtime="$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app/Contents/MacOS/firefox"
mkdir -p "$(dirname "$runtime")" "$HOME/Applications/Google Calendar.app"
: > "$runtime"
chmod +x "$runtime"
printf '%s\n' "- Google Calendar: $manifest_url ($site_id)" > "$FIREFOXPWA_TEST_PROFILE_LIST"
bash "$script"
assert_log "runtime patch
profile list"

setup_case repair
runtime="$HOME/Library/Application Support/firefoxpwa/runtime/Firefox.app/Contents/MacOS/firefox"
mkdir -p "$(dirname "$runtime")"
: > "$runtime"
chmod +x "$runtime"
printf '%s\n' "- Google Calendar: $manifest_url ($site_id)" > "$FIREFOXPWA_TEST_PROFILE_LIST"
bash "$script"
assert_log "runtime patch
profile list
site update $site_id"

setup_case linux
export FIREFOXPWA_PLATFORM="Linux"
bash "$script"
[[ ! -s "$FIREFOXPWA_TEST_LOG" ]] || fail "non-macOS execution should be a no-op"

printf 'PASS: FirefoxPWA Google Calendar bootstrap\n'
