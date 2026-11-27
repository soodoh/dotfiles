#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
work=$(CDPATH='' cd -- "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$work"' EXIT

# Copy browser.sh into a relocated checkout with a space, backslash, and single
# quote in its path to verify self-derived resolution and sh/Fish quoting.
checkout="$work/relocated\\'s repo"
script_dir="$checkout/dotfiles/macos/herdr"
mkdir -p "$script_dir" "$work/bin" "$work/state/terminal-browser"
cp "$root/dotfiles/macos/herdr/browser.sh" "$script_dir/browser.sh"
chmod 0755 "$script_dir/browser.sh"
browser_sh="$script_dir/browser.sh"

log="$work/calls.log"
: >"$log"

cat >"$work/bin/terminal-browser" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'browser|no_telemetry=%s|url_env=%s|args=%s\n' \
  "${TERMINAL_BROWSER_NO_TELEMETRY:-}" \
  "${DOTFILES_HERDR_BROWSER_URL-UNSET}" \
  "$*" >>"$TEST_LOG"
EOF

cat >"$work/bin/mise" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'mise|%s\n' "$*" >>"$TEST_LOG"
if [[ $1 == -C && $3 == --no-env && $4 == --no-hooks && $5 == which ]]; then
  if [[ $2 != "$EXPECTED_REPO" ]]; then
    printf 'unexpected repo: %s\n' "$2" >&2
    exit 1
  fi
  case "$6" in
    terminal-browser) printf '%s/terminal-browser\n' "$TEST_BIN" ;;
    jq) command -v jq ;;
    *) exit 1 ;;
  esac
  exit 0
fi
exit 1
EOF

cat >"$work/bin/herdr" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'herdr|%s\n' "$*" >>"$TEST_LOG"
case "$1 $2" in
  "notification show")
    exit 0
    ;;
  "plugin pane")
    exit 0
    ;;
  "tab create")
    printf '{"result":{"root_pane":{"pane_id":"pane-tab-1"}}}\n'
    ;;
  "pane split")
    printf '{"result":{"pane":{"pane_id":"pane-split-2"}}}\n'
    ;;
  "pane run")
    printf '%s\n' "$4" >"$TEST_PANE_CMD"
    ;;
  *)
    printf 'unexpected herdr args: %s\n' "$*" >&2
    exit 1
    ;;
esac
EOF
chmod 0755 "$work/bin/terminal-browser" "$work/bin/mise" "$work/bin/herdr"

run_browser() {
  TEST_LOG="$log" \
  TEST_BIN="$work/bin" \
  TEST_PANE_CMD="$work/pane-cmd.txt" \
  EXPECTED_REPO="$checkout" \
  MISE_BIN="$work/bin/mise" \
  XDG_STATE_HOME="$work/state" \
  HERDR_BIN_PATH="$work/bin/herdr" \
  HERDR_SOCKET_PATH="$work/herdr.sock" \
    "$@"
}

# 1. Missing skills-choice fails and notifies Herdr for non-open modes.
if run_browser env HERDR_ACTIVE_WORKSPACE_ID=ws-1 "$browser_sh" tab 2>"$work/err"; then
  printf 'expected missing skills-choice to fail\n' >&2
  exit 1
fi
grep -Fq 'configure:terminal-browser-skill' "$work/err"
grep -Fq 'herdr|notification show Herdr browser --body Run mise run configure:terminal-browser-skill first.' "$log"

printf 'no\n' >"$work/state/terminal-browser/skills-choice"

# 2. open launches about:blank with telemetry disabled and relocated repo.
: >"$log"
run_browser "$browser_sh" open
grep -Fq 'browser|no_telemetry=1|url_env=UNSET|args=open --no-merge about:blank' "$log"

# 3. open-link validates HTTP(S), unsets DOTFILES_HERDR_BROWSER_URL, and rejects non-HTTP(S).
: >"$log"
run_browser env DOTFILES_HERDR_BROWSER_URL="https://example.com/a?b=1" "$browser_sh" open-link
grep -Fq 'browser|no_telemetry=1|url_env=UNSET|args=open --no-merge https://example.com/a?b=1' "$log"

if run_browser env DOTFILES_HERDR_BROWSER_URL="javascript:alert(1)" "$browser_sh" open-link 2>"$work/err"; then
  printf 'expected non-HTTP(S) URL to fail\n' >&2
  exit 1
fi
grep -Fq 'Expected an HTTP(S) link.' "$work/err"

# 4. link opens a plugin pane with the clicked URL passed via --env.
: >"$log"
run_browser env HERDR_WORKSPACE_ID=ws-9 HERDR_PLUGIN_CLICKED_URL="http://localhost:3000" "$browser_sh" link
grep -Fq 'herdr|plugin pane open --plugin dotfiles.browser-links --entrypoint browser --workspace ws-9 --focus --env DOTFILES_HERDR_BROWSER_URL=http://localhost:3000' "$log"

# 5. tab creates a tab, parses pane_id, and runs the quoted self-derived script path.
: >"$log"
pane=$(run_browser env HERDR_ACTIVE_WORKSPACE_ID=ws-3 "$browser_sh" tab)
[[ $pane == "pane-tab-1" ]]
pane_cmd=$(cat "$work/pane-cmd.txt")
: >"$log"
run_browser /bin/sh -c "$pane_cmd"
grep -Fq 'browser|no_telemetry=1|url_env=UNSET|args=open --no-merge about:blank' "$log"
if command -v fish >/dev/null 2>&1; then
  : >"$log"
  run_browser fish -c "$pane_cmd"
  grep -Fq 'browser|no_telemetry=1|url_env=UNSET|args=open --no-merge about:blank' "$log"
fi

# 6. split splits the active pane and launches the browser in the new pane.
: >"$log"
pane=$(run_browser env HERDR_ACTIVE_PANE_ID=pane-7 "$browser_sh" split)
[[ $pane == "pane-split-2" ]]
grep -Fq 'herdr|pane split pane-7 --direction right --focus' "$log"

# 7. Invoking browser.sh without a directory prefix still resolves the repo.
: >"$log"
(cd "$script_dir" && run_browser /bin/sh browser.sh open)
grep -Fq 'browser|no_telemetry=1|url_env=UNSET|args=open --no-merge about:blank' "$log"

# 8. Invoking via a script symlink or via PATH from another directory resolves the relocated repo.
mkdir -p "$work/links" "$work/elsewhere"
ln -s "$browser_sh" "$work/links/herdr-browser"
: >"$log"
(cd "$work/elsewhere" && run_browser "$work/links/herdr-browser" open)
grep -Fq 'browser|no_telemetry=1|url_env=UNSET|args=open --no-merge about:blank' "$log"

: >"$log"
(cd "$work/elsewhere" && PATH="$work/links:$PATH" run_browser herdr-browser open)
grep -Fq 'browser|no_telemetry=1|url_env=UNSET|args=open --no-merge about:blank' "$log"

# 9. Relative ../ symlinks inside a symlinked parent directory resolve physically.
mkdir -p "$work/phys/nested"
ln -s "$work/phys/nested" "$work/sym-parent"
ln -s "../../relocated\\'s repo/dotfiles/macos/herdr/browser.sh" "$work/phys/nested/rel-browser"
: >"$log"
(cd "$work/elsewhere" && run_browser "$work/sym-parent/rel-browser" open)
grep -Fq 'browser|no_telemetry=1|url_env=UNSET|args=open --no-merge about:blank' "$log"

# 10. A broken local symlink in $PWD does not hijack PATH-resolved execution.
mkdir -p "$work/broken-cwd"
ln -s "$work/does-not-exist" "$work/broken-cwd/herdr-browser"
: >"$log"
(cd "$work/broken-cwd" && PATH="$work/links:$PATH" run_browser bash --posix herdr-browser open)
grep -Fq 'browser|no_telemetry=1|url_env=UNSET|args=open --no-merge about:blank' "$log"
