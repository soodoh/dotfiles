#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install
  echo "Complete the Command Line Tools installation, then rerun this script."
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
else
  eval "$(/usr/local/bin/brew shellenv)"
fi

brew update
brew install git uv
uv tool install --upgrade ansible-core
uv tool install --upgrade ansible-lint
"$HOME/.local/bin/ansible-galaxy" collection install -r "$REPO_ROOT/ansible/requirements.yml" --upgrade

echo "Bootstrap complete. Run ./bin/apply-personal-macos or ./bin/apply-work-macos."
