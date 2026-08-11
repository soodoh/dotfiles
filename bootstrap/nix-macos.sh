#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host="${1:-personal-macos}"
case "$host" in personal-macos|work-macos) ;; *) echo >&2 "usage: $0 [personal-macos|work-macos]"; exit 2 ;; esac
if ! command -v nix >/dev/null 2>&1; then
  curl -L https://nixos.org/nix/install | sh -s -- --daemon
fi
nix_command="$(command -v nix 2>/dev/null || printf /nix/var/nix/profiles/default/bin/nix)"
cd "$repo_root"
sudo --set-home "$nix_command" --extra-experimental-features 'nix-command flakes' run .#darwin-rebuild -- switch --flake ".#$host"
