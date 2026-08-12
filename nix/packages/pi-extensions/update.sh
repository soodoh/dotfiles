#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

target="${1:-all}"
requested_version="${2:-}"
workspace_manifest="../../../pi-extensions/package.json"
check_script="../../../bin/check-dependency-sync"

sync_workspace_dependencies() {
  jq -S --slurpfile workspace "$workspace_manifest" '
    . as $wrapper
    | .dependencies = (
        ($workspace[0].dependencies // {})
        + (reduce (.bundledPiPackages // [])[] as $package
            ({};
              if $wrapper.dependencies[$package] == null then
                .
              else
                .[$package] = $wrapper.dependencies[$package]
              end
            ))
      )
  ' package.json > package.json.tmp
  mv package.json.tmp package.json
}

set_dependency_version() {
  local package_name="$1"
  local version="$2"
  jq -S --arg package "$package_name" --arg version "$version" \
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

case "$target" in
  check)
    exec "$check_script"
    ;;
  all)
    sync_workspace_dependencies
    while IFS= read -r package_name; do
      update_dependency "$package_name"
    done < <(jq -r '.bundledPiPackages[]' package.json)
    ;;
  *)
    if ! jq -e --arg package "$target" '.bundledPiPackages | index($package) != null' package.json >/dev/null; then
      echo >&2 "unknown bundled Pi extension dependency: $target"
      exit 2
    fi
    update_dependency "$target" "$requested_version"
    ;;
esac

"$check_script"
npm install --package-lock-only --legacy-peer-deps --ignore-scripts --no-audit --no-fund
node ../fix-npm-lock-integrity.mjs package-lock.json
nix build ../../..#pi-extensions.dependencies --no-link
printf 'Updated the pinned Pi extension closure\n'
