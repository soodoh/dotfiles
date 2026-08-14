#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
manifest="$repo_root/pi-extensions/package.json"
target="${1:-all}"
requested_version="${2:-}"

project_npm() {
  (
    cd "$repo_root/pi-extensions"
    COREPACK_ENABLE_PROJECT_SPEC=1 corepack npm "$@"
  )
}

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
    version="$(project_npm view "$package_name" version)"
  fi
  set_dependency_version "$package_name" "$version"
}

case "$target" in
  check)
    project_npm ci --dry-run --ignore-scripts --no-audit --no-fund >/dev/null
    exit
    ;;
  all)
    while IFS= read -r package_name; do
      update_dependency "$package_name"
    done < <(jq -r '.bundleDependencies[]' "$manifest")
    ;;
  *)
    if ! jq -e --arg package "$target" '.bundleDependencies | index($package) != null' "$manifest" >/dev/null; then
      echo >&2 "unknown bundled Pi extension dependency: $target"
      exit 2
    fi
    update_dependency "$target" "$requested_version"
    ;;
esac

project_npm install --package-lock-only --ignore-scripts --no-audit --no-fund
project_npm ci --dry-run --ignore-scripts --no-audit --no-fund >/dev/null
nix build "$repo_root#pi-extensions.dependencies" --no-link
printf 'Updated the pinned Pi extension closure\n'
