#!/bin/sh
set -eu

repo="$HOME/.local/share/dotfiles"
mise="$HOME/.local/bin/mise"
mode="$1"

fail() {
  printf 'Herdr browser: %s\n' "$1" >&2
  if [ "$mode" != open ] && [ -n "${HERDR_BIN_PATH:-}" ]; then
    "$HERDR_BIN_PATH" notification show 'Herdr browser' --body "$1" >/dev/null 2>&1 || :
  fi
  exit 1
}

case "${XDG_STATE_HOME:-}" in
  /*) state="$XDG_STATE_HOME" ;;
  *) state="$HOME/.local/state" ;;
esac
# Upstream otherwise installs agent skills automatically on first launch.
if ! grep -qx no "$state/terminal-browser/skills-choice" 2>/dev/null; then
  fail 'Run terminal-browser setup in a terminal and answer n to agent skills.'
fi

browser=$("$mise" -C "$repo" --no-env --no-hooks which terminal-browser) || fail 'Install terminal-browser with mise first.'
if [ "$mode" = open ]; then
  export TERMINAL_BROWSER_NO_TELEMETRY=1
  exec "$browser" open --no-merge about:blank
fi

herdr="${HERDR_BIN_PATH:?missing Herdr binary}"
: "${HERDR_SOCKET_PATH:?missing Herdr socket}"
jq=$("$mise" -C "$repo" --no-env --no-hooks which jq) || fail 'Install jq with mise first.'
case "$mode" in
  tab)
    result=$("$herdr" tab create --workspace "${HERDR_ACTIVE_WORKSPACE_ID:?missing workspace}" --cwd "$PWD" --label Browser --focus) || fail 'Could not create a browser tab.'
    pane=$(printf '%s\n' "$result" | "$jq" -er '.result.root_pane.pane_id') || fail 'Could not identify the new tab pane.'
    ;;
  split)
    result=$("$herdr" pane split "${HERDR_ACTIVE_PANE_ID:?missing pane}" --direction right --focus) || fail 'Could not create a browser split.'
    pane=$(printf '%s\n' "$result" | "$jq" -er '.result.pane.pane_id') || fail 'Could not identify the new split pane.'
    ;;
  *) fail 'Expected tab, split, or open.' ;;
esac
# Expand HOME in the destination pane, not in the detached launcher.
# shellcheck disable=SC2016
"$herdr" pane run "$pane" '/bin/sh "$HOME/.local/share/dotfiles/dotfiles/macos/herdr/browser.sh" open' >/dev/null || fail 'Could not start the browser in the new pane.'
