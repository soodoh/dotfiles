#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
manifest="$repo_root/pi-extensions/package.json"
check_script="$repo_root/bin/check-dependency-sync"
target="${1:-all}"
requested_version="${2:-}"

set_dependency_version() {
  local package_name="$1"
  local version="$2"
  jq --tab --arg package "$package_name" --arg version "$version" \
    '.dependencies[$package] = $version' "$manifest" > "$manifest.tmp"
  mv "$manifest.tmp" "$manifest"
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

case "$target" in
  check)
    exec "$check_script"
    ;;
  all)
    while IFS= read -r package_name; do
      update_dependency "$package_name"
    done < <(jq -r '.bundledPiPackages[]' "$manifest")
    ;;
  *)
    if ! jq -e --arg package "$target" '.bundledPiPackages | index($package) != null' "$manifest" >/dev/null; then
      echo >&2 "unknown bundled Pi extension dependency: $target"
      exit 2
    fi
    update_dependency "$target" "$requested_version"
    ;;
esac

cd "$repo_root/pi-extensions"
npm install --package-lock-only --workspaces=false --legacy-peer-deps --install-links=false --ignore-scripts --no-audit --no-fund
node ../nix/packages/fix-npm-lock-integrity.mjs package-lock.json
cd "$repo_root"
bun install --lockfile-only --ignore-scripts
"$check_script"
nix build "$repo_root#pi-extensions.dependencies" --no-link
printf 'Updated the pinned Pi extension closure\n'
