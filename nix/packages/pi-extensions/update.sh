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

update_core() {
  local version="${1:-}"
  if [ -z "$version" ]; then
    version="$(npm view @earendil-works/pi-coding-agent version)"
  fi
  for package_name in \
    @earendil-works/pi-agent-core \
    @earendil-works/pi-ai \
    @earendil-works/pi-coding-agent \
    @earendil-works/pi-tui; do
    set_dependency_version "$package_name" "$version"
  done
}

case "$target" in
  core)
    update_core "$requested_version"
    ;;
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

npm install --package-lock-only --ignore-scripts --no-audit --no-fund
node ../fix-npm-lock-integrity.mjs package-lock.json
hash="$(nix run ../../..#prefetch-npm-deps -- package-lock.json)"
python3 - "$hash" <<'PY'
from pathlib import Path
import re, sys
path = Path("default.nix")
text = path.read_text()
text = re.sub(r'npmDepsHash = "[^"]+";', f'npmDepsHash = "{sys.argv[1]}";', text, count=1)
path.write_text(text)
PY
printf 'Updated the pinned Pi extension closure (%s)\n' "$hash"
