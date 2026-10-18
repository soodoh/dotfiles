#!/bin/bash
# Startup/development only. Registered event scripts invoke the binary directly.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
sources=("$root"/Sources/*.swift)
if [[ "${1:-}" == test ]]; then
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/sketchybar-tests.XXXXXX")"
  trap 'rm -rf "$temporary"' EXIT
  library=()
  for source in "${sources[@]}"; do
    [[ "$source" == */Entry.swift ]] || library+=("$source")
  done
  xcrun swiftc -parse-as-library "${library[@]}" "$root"/Tests/*.swift -o "$temporary/tests"
  "$temporary/tests"
  exit
fi
cache="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar"
binary="$cache/sketchybar-helper"
mkdir -p "$cache"
rebuild=false
[[ -x "$binary" ]] || rebuild=true
for source in "${sources[@]}" "$0"; do
  [[ "$source" -nt "$binary" ]] && rebuild=true
done
if [[ "$rebuild" == true ]]; then
  temporary="$(mktemp -d "$cache/.swift-build.XXXXXX")"
  trap 'rm -rf "$temporary"' EXIT
  xcrun swiftc -O -parse-as-library "${sources[@]}" -o "$temporary/sketchybar-helper"
  # Concurrent startups may compile independently, but never expose a partial
  # executable. Keep the old working binary if compilation fails.
  mv -f "$temporary/sketchybar-helper" "$binary"
fi
printf '%s\n' "$binary"
