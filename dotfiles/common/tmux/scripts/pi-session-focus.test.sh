#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pi-session-focus
source "$script_dir/pi-session-focus"

assert_equal() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL %s: expected %q, got %q\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

clients=$'20\t/dev/ttys001\txterm-ghostty\tattached,UTF-8\n10\t/dev/ttys002\txterm-ghostty\tattached,focused,UTF-8\n30\t/dev/ttys003\txterm-ghostty\tattached,UTF-8'
assert_equal "/dev/ttys002" "$(select_ghostty_client <<<"$clients")" \
  "focused Ghostty client wins"

clients=$'20\t/dev/ttys001\txterm-ghostty\tattached,UTF-8\n30\t/dev/ttys003\txterm-ghostty\tattached,UTF-8'
assert_equal "/dev/ttys003" "$(select_ghostty_client <<<"$clients")" \
  "most recently active client is the fallback"

clients=$'40\t/dev/ttys004\txterm-256color\tattached,focused,UTF-8\ninvalid\t/dev/ttys005\txterm-ghostty\tattached,focused,UTF-8'
assert_equal "" "$(select_ghostty_client <<<"$clients")" \
  "non-Ghostty and malformed clients are ignored"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
capture="$tmp_dir/args"
fake_tmux="$tmp_dir/tmux"
cat >"$fake_tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$PI_SESSION_FOCUS_CAPTURE"
FAKE_TMUX
chmod +x "$fake_tmux"
fake_lsof="$tmp_dir/lsof"
cat >"$fake_lsof" <<FAKE_LSOF
#!/usr/bin/env bash
printf '%s\n' p953 ftxt 'n$fake_tmux' ftxt n/usr/lib/dyld
FAKE_LSOF
chmod +x "$fake_lsof"
assert_equal "$fake_tmux" "$(resolve_tmux_bin 953 "$fake_lsof")" \
  "server executable bypasses cwd-dependent mise shim"
export PI_SESSION_FOCUS_CAPTURE="$capture"
tmux_command=("$fake_tmux" -S /tmp/test.sock)
focus_tmux_pane /dev/ttys009 %9

expected=$'-S\n/tmp/test.sock\nselect-window\n-t\n%9\n;\nselect-pane\n-t\n%9\n;\nswitch-client\n-c\n/dev/ttys009\n-t\n%9'
assert_equal "$expected" "$(<"$capture")" \
  "window and pane are selected before switching the client"

printf 'pi-session-focus tests passed\n'
