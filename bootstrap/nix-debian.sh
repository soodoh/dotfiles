#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for command_name in curl fish; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo >&2 "Missing native $command_name. Run: sudo apt update && sudo apt install curl fish git"
    exit 1
  fi
done
if ! command -v nix >/dev/null 2>&1; then
  curl -L https://nixos.org/nix/install | sh -s -- --daemon
fi
nix_command="$(command -v nix 2>/dev/null || printf /nix/var/nix/profiles/default/bin/nix)"
cd "$repo_root"
"$nix_command" --extra-experimental-features 'nix-command flakes' run .#home-manager -- switch --flake .#personal-debian
echo "Set the native login shell once: chsh -s /usr/bin/fish"
