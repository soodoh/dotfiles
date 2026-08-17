#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

command -v mise >/dev/null || {
  printf 'error: mise is required for config validation\n' >&2
  exit 69
}

for profile in personal-macos work-macos; do
  mise --env "$profile" config >/dev/null
  mise --env "$profile" tasks validate >/dev/null
  resolved_profile=$(mise --env "$profile" env --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["DOTFILES_PROFILE"])')
  [[ $resolved_profile == "$profile" ]] || { printf 'error: profile environment did not resolve: %s\n' "$profile" >&2; exit 1; }
  scripts/bootstrap/require-profile.sh "$resolved_profile"
done

if scripts/bootstrap/require-profile.sh invalid-profile >/dev/null 2>&1; then
  printf 'error: profile guard accepted an invalid profile\n' >&2
  exit 1
fi

python3 - <<'PY'
import pathlib
import tomllib

for path in sorted(pathlib.Path('.').glob('mise*.toml')):
    tomllib.loads(path.read_text())
for path in sorted(pathlib.Path('.').glob('mise*.lock')):
    tomllib.loads(path.read_text())
PY
