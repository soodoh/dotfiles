#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OS_ID="$(awk -F= '$1 == "ID" { gsub(/\"/, "", $2); print $2 }' /etc/os-release)"
if [[ "$OS_ID" != "debian" ]]; then
  echo "This bootstrap supports Debian 13+, not Ubuntu or other derivatives." >&2
  exit 1
fi

DEBIAN_MAJOR="$(awk -F= '$1 == "VERSION_ID" { gsub(/\"/, "", $2); print $2 }' /etc/os-release | cut -d. -f1)"
if (( DEBIAN_MAJOR < 13 )); then
  echo "Debian 13 or newer is required." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y curl git python3 python3-venv
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
"$HOME/.local/bin/uv" tool install --upgrade ansible-core
"$HOME/.local/bin/uv" tool install --upgrade ansible-lint
"$HOME/.local/bin/ansible-galaxy" collection install -r "$REPO_ROOT/ansible/requirements.yml" --upgrade

echo "Bootstrap complete. Run ./bin/apply-personal-debian."
