#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

while IFS= read -r -d '' script; do
  bash -n "$script"
done < <(find scripts dotfiles -type f -name '*.sh' -print0)

if command -v shellcheck >/dev/null 2>&1; then
  find scripts -type f -name '*.sh' -print0 | xargs -0 shellcheck
fi

if command -v fish >/dev/null 2>&1; then
  fish --no-execute dotfiles/common/.config/fish/config.fish
  while IFS= read -r -d '' fish_file; do
    fish --no-execute "$fish_file"
  done < <(find dotfiles -type f -name '*.fish' -print0)
fi
