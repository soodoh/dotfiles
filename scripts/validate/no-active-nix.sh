#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

patterns='/nix/store|/run/current-system|/etc/profiles/per-user|nix-darwin|home-manager|nix run|nix build'
targets=(mise.toml mise.personal-macos.toml mise.work-macos.toml dotfiles packages scripts .github renovate.json package.json)

# During the single-replacement migration, legacy implementation and operator docs
# remain until the final deletion gate. Once they are gone, include all active root docs.
if [[ ! -e flake.nix && ! -d nix ]]; then
  targets+=(README.md AGENTS.md CLAUDE.md server.md)
fi

if rg -n -i "$patterns" "${targets[@]}" \
  --glob '!docs/migration-parity.md' \
  --glob '!scripts/validate/no-active-nix.sh' \
  --glob '!scripts/validate/neovim.sh'; then
  printf 'error: active configuration references a removed Nix runtime path or command\n' >&2
  exit 1
fi
