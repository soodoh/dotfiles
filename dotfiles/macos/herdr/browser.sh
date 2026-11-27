#!/bin/sh
set -eu

script="$0"
case "$script" in
  */*) ;;
  *)
    if [ ! -e "$script" ]; then
      resolved=$(command -v -- "$script" 2>/dev/null || :)
      case "$resolved" in
        */*) script="$resolved" ;;
      esac
    fi
    ;;
esac
hops=0
while [ -L "$script" ]; do
  hops=$((hops + 1))
  [ "$hops" -le 40 ] || {
    printf 'Herdr browser: too many symlink levels resolving %s\n' "$0" >&2
    exit 1
  }
  link=$(readlink -- "$script")
  case "$link" in
    /*) script="$link" ;;
    *)
      dir="${script%/*}"
      [ "$dir" = "$script" ] && dir=.
      dir=$(CDPATH='' cd -P -- "${dir:-/}" && pwd -P)
      case "$dir" in
        /) script="/$link" ;;
        *) script="$dir/$link" ;;
      esac
      ;;
  esac
done
case "$script" in
  */*)
    dir="${script%/*}"
    self_dir=$(CDPATH='' cd -P -- "${dir:-/}" && pwd -P)
    ;;
  *) self_dir=$(pwd -P) ;;
esac
self="$self_dir/${script##*/}"
repo=$(CDPATH='' cd -P -- "$self_dir/../../.." && pwd -P)
if [ -n "${MISE_BIN:-}" ]; then
  mise="$MISE_BIN"
elif mise=$(command -v mise 2>/dev/null); then
  :
else
  mise="$HOME/.local/bin/mise"
fi
mode="${1:-}"

# Quote for both POSIX sh and Fish: escape single quotes and backslashes
# outside single-quoted segments so neither shell interprets them.
sh_quote() {
  awk -- 'BEGIN {
    q = sprintf("%c", 39)
    s = ARGV[1]
    out = q
    for (i = 1; i <= length(s); i++) {
      c = substr(s, i, 1)
      if (c == q) out = out q "\\" q q
      else if (c == "\\") out = out q "\\\\" q
      else out = out c
    }
    printf "%s%s", out, q
    exit
  }' "$1"
}

fail() {
  printf 'Herdr browser: %s\n' "$1" >&2
  case "$mode" in
    open|configure-skill) ;;
    *)
      if [ -n "${HERDR_BIN_PATH:-}" ]; then
        "$HERDR_BIN_PATH" notification show 'Herdr browser' --body "$1" >/dev/null 2>&1 || :
      fi
      ;;
  esac
  exit 1
}

case "${XDG_STATE_HOME:-}" in
  /*) state="$XDG_STATE_HOME" ;;
  *) state="$HOME/.local/state" ;;
esac
choice="$state/terminal-browser/skills-choice"

if [ "$mode" = configure-skill ]; then
  browser=$("$mise" -C "$repo" --no-env --no-hooks which terminal-browser) || fail 'Install terminal-browser with mise first.'
  skill="${browser%/bin/terminal-browser}/skills/default/terminal-browser"
  target="$HOME/.pi/agent/skills/terminal-browser"
  [ -f "$skill/SKILL.md" ] || fail "Missing bundled skill: $skill"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    fail "Refusing to replace $target"
  fi
  # The CLI otherwise installs into ~/.agents/skills on first use.
  if [ ! -e "$choice" ] && [ ! -L "$choice" ]; then
    mkdir -p "${choice%/*}"
    (set -C; printf 'no\n' > "$choice") 2>/dev/null || :
    [ -e "$choice" ] || [ -L "$choice" ] || fail "Could not write $choice."
  fi
  grep -qx no "$choice" 2>/dev/null || fail 'Run terminal-browser setup and decline agent skill installation.'
  mkdir -p "${target%/*}"
  ln -sfn "$skill" "$target"
  exit 0
fi

# Upstream otherwise installs agent skills automatically on first launch.
if ! grep -qx no "$choice" 2>/dev/null; then
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
  *) fail 'Expected configure-skill, tab, split, open, link, or open-link.' ;;
esac
"$herdr" pane run "$pane" "/bin/sh $(sh_quote "$self") open" >/dev/null || fail 'Could not start the browser in the new pane.'
printf '%s\n' "$pane"
