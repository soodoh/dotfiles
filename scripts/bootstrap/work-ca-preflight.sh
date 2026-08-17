#!/usr/bin/env bash
set -euo pipefail

profile=${DOTFILES_PROFILE:-${MISE_ENV:-}}
[[ $profile == work-macos ]] || exit 0
bundle='/Library/Application Support/DocuSign/zscaler-ca-bundle.pem'
if [[ ! -r $bundle ]]; then
  printf 'error: required corporate CA bundle is not readable: %s\n' "$bundle" >&2
  exit 66
fi
