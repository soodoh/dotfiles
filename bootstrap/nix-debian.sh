#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for command_name in curl fish; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo >&2 "Missing native $command_name. Run: sudo apt update && sudo apt install curl fish git"
    exit 1
  fi
done
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
"$nix_command" \
  --extra-experimental-features 'nix-command flakes' \
  --option max-jobs auto \
  --option cores 0 \
  run .#home-manager -- switch --flake .#personal-debian
echo "Set the native login shell once: chsh -s /usr/bin/fish"
