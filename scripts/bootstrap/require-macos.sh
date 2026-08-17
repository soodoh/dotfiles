#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Darwin ]]; then
  profile=${DOTFILES_PROFILE:-${MISE_ENV:-unset}}
  printf 'error: profile %s is macOS-only; the shared tools may be installed separately on Linux\n' "$profile" >&2
  exit 69
fi
