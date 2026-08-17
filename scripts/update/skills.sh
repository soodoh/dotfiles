#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
canonical="$repo_root/dotfiles/profiles/common"
generated_dir="$canonical/.pi/agent/skills"
version=${SKILLS_CLI_VERSION:-1.5.22}

[[ ! -e $generated_dir && ! -L $generated_dir ]] || {
  printf 'error: refusing to replace unexpected generated directory: %s\n' "$generated_dir" >&2
  exit 1
}

HOME="$canonical" npx --yes "skills@$version" update --global --yes
rm -rf "$generated_dir"
node "$repo_root/scripts/update/personal-skill-lock.mjs"
