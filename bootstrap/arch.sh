#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sudo pacman -Syu --needed git python uv
uv tool install --upgrade ansible-core
uv tool install --upgrade ansible-lint
"$HOME/.local/bin/ansible-galaxy" collection install -r "$REPO_ROOT/ansible/requirements.yml" --upgrade

echo "Bootstrap complete. Run ./bin/apply-personal-arch."
