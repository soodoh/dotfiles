#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) package='@jarkkojs/readseek-darwin-arm64' ;;
  Linux-aarch64 | Linux-arm64) package='@jarkkojs/readseek-linux-arm64' ;;
  Linux-x86_64) package='@jarkkojs/readseek-linux-x64' ;;
  *)
    printf 'error: ReadSeek has no supported binary for %s/%s\n' "$(uname -s)" "$(uname -m)" >&2
    exit 69
    ;;
esac
binary="$repo_root/pi-extensions/node_modules/$package/bin/readseek"
[[ -x $binary ]] || {
  printf 'error: ReadSeek binary is missing or not executable: %s\n' "$binary" >&2
  exit 66
}

if [[ $(uname -s) == Darwin ]]; then
  dependencies=$(otool -L "$binary")
  grep -F 'libgit2' <<<"$dependencies" >/dev/null || {
    printf 'error: ReadSeek does not declare its libgit2 dependency\n' >&2
    exit 65
  }
  while IFS= read -r dependency; do
    dependency=${dependency%% (*}
    [[ $dependency == /* ]] || continue
    [[ -e $dependency ]] || {
      printf 'error: ReadSeek dependency is missing: %s\n' "$dependency" >&2
      exit 66
    }
  done < <(awk '/libgit2/{gsub(/^\t/, ""); print}' <<<"$dependencies")
else
  if ldd "$binary" 2>&1 | grep -F 'not found' >/dev/null; then
    ldd "$binary" >&2
    exit 66
  fi
fi

"$binary" --help >/dev/null
