#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host="${1:-personal-macos}"
case "$host" in personal-macos|work-macos) ;; *) echo >&2 "usage: $0 [personal-macos|work-macos]"; exit 2 ;; esac
nix_command="$(command -v nix 2>/dev/null || true)"
if [ -z "$nix_command" ] && [ -x /nix/var/nix/profiles/default/bin/nix ]; then
  nix_command=/nix/var/nix/profiles/default/bin/nix
elif [ -z "$nix_command" ]; then
  curl -L https://nixos.org/nix/install | sh -s -- --daemon
  nix_command=/nix/var/nix/profiles/default/bin/nix
fi
if [ ! -x "$nix_command" ]; then
  echo >&2 "Nix installation completed without creating $nix_command"
  exit 1
fi
cd "$repo_root"
sudo --set-home "$nix_command" --extra-experimental-features 'nix-command flakes' run .#darwin-rebuild -- switch --flake ".#$host"
