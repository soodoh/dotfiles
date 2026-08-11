#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

target="${1:-all}"
requested_version="${2:-}"

set_dependency_version() {
  local package_name="$1"
  local version="$2"
  jq --arg package "$package_name" --arg version "$version" \
    '.dependencies[$package] = $version' package.json > package.json.tmp
  mv package.json.tmp package.json
  printf 'Pinned %s at %s\n' "$package_name" "$version"
}

update_dependency() {
  local package_name="$1"
  local version="${2:-}"
  if [ -z "$version" ]; then
    version="$(npm view "$package_name" version)"
  fi
  set_dependency_version "$package_name" "$version"
}

set_npm_deps_hash() {
  python3 - "$1" <<'PY'
from pathlib import Path
import re, sys
path = Path("default.nix")
text = path.read_text()
text = re.sub(r'npmDepsHash = "[^"]+";', f'npmDepsHash = "{sys.argv[1]}";', text, count=1)
path.write_text(text)
PY
}

case "$target" in
  all)
    while IFS= read -r package_name; do
      update_dependency "$package_name"
    done < <(jq -r '.bundledPiPackages[]' package.json)
    ;;
  *)
    if ! jq -e --arg package "$target" '.dependencies[$package] != null' package.json >/dev/null; then
      echo >&2 "unknown Pi extension dependency: $target"
      exit 2
    fi
    update_dependency "$target" "$requested_version"
    ;;
esac

npm install --package-lock-only --legacy-peer-deps --ignore-scripts --no-audit --no-fund
node ../fix-npm-lock-integrity.mjs package-lock.json
fake_hash="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
set_npm_deps_hash "$fake_hash"
if build_output="$(nix build ../../..#pi-extensions.dependencies --no-link 2>&1)"; then
  echo >&2 "dependency build unexpectedly accepted the fake npm hash"
  exit 1
fi
hash="$(printf '%s\n' "$build_output" | sed -n 's/^[[:space:]]*got:[[:space:]]*//p' | tail -n 1)"
if [ -z "$hash" ]; then
  printf '%s\n' "$build_output" >&2
  echo >&2 "failed to determine the npm dependency hash"
  exit 1
fi
set_npm_deps_hash "$hash"
printf 'Updated the pinned Pi extension closure (%s)\n' "$hash"
