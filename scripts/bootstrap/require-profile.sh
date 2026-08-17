#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'usage: %s [--explicit expected-profile | profile]\n' "$0" >&2
  exit 64
}

valid_profile() {
  [[ $1 == personal-macos || $1 == work-macos ]]
}

explicit_cli_profile() {
  local pid=$PPID process_name command_line
  for _ in 1 2 3 4; do
    process_name=$(ps -o comm= -p "$pid" 2>/dev/null | xargs basename 2>/dev/null || true)
    command_line=$(ps -o command= -p "$pid" 2>/dev/null || true)
    if [[ $process_name == mise && $command_line =~ (^|[[:space:]])(--env|-E)[=[:space:]](personal-macos|work-macos)([[:space:]]|$) ]]; then
      printf '%s\n' "${BASH_REMATCH[3]}"
      return 0
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [[ -n $pid && $pid != 1 ]] || break
  done
  return 1
}

case $# in
  0)
    profile=$(explicit_cli_profile || true)
    ;;
  1)
    profile=$1
    ;;
  2)
    [[ $1 == --explicit ]] || usage
    expected=$2
    valid_profile "$expected" || usage
    profile=$(explicit_cli_profile || true)
    [[ $profile == "$expected" ]] || profile=''
    ;;
  *) usage ;;
esac

if ! valid_profile "${profile:-}"; then
  printf 'error: choose an explicit profile: mise --env personal-macos bootstrap or mise --env work-macos bootstrap\n' >&2
  exit 64
fi
