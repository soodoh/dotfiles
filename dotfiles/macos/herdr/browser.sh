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
  fail 'Run mise run configure:terminal-browser-skill first.'
fi

browser=$("$mise" -C "$repo" --no-env --no-hooks which terminal-browser) || fail 'Install terminal-browser with mise first.'
web_url() {
  case "$1" in
    http://?*|https://?*) ;;
    *) fail 'Expected an HTTP(S) link.' ;;
  esac
}

case "$mode" in
  open|open-link)
    url=about:blank
    if [ "$mode" = open-link ]; then
      url="${DOTFILES_HERDR_BROWSER_URL:-}"
      web_url "$url"
      unset DOTFILES_HERDR_BROWSER_URL
    fi
    export TERMINAL_BROWSER_NO_TELEMETRY=1
    exec "$browser" open --no-merge "$url"
    ;;
esac

herdr="${HERDR_BIN_PATH:?missing Herdr binary}"
: "${HERDR_SOCKET_PATH:?missing Herdr socket}"
if [ "$mode" = link ]; then
  url="${HERDR_PLUGIN_CLICKED_URL:-}"
  web_url "$url"
  # A plugin pane runs argv directly in a fresh PTY; the URL is never shell input.
  "$herdr" plugin pane open --plugin dotfiles.browser-links --entrypoint browser \
    --workspace "${HERDR_WORKSPACE_ID:?missing clicked workspace}" --focus \
    --env "DOTFILES_HERDR_BROWSER_URL=$url" >/dev/null || fail 'Could not open the link in a browser tab.'
  exit 0
fi

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
  *) fail 'Expected tab, split, open, link, or open-link.' ;;
esac
# Expand HOME in the destination pane, not in the detached launcher.
# shellcheck disable=SC2016
"$herdr" pane run "$pane" '/bin/sh "$HOME/.local/share/dotfiles/dotfiles/macos/herdr/browser.sh" open' >/dev/null || fail 'Could not start the browser in the new pane.'
printf '%s\n' "$pane"
