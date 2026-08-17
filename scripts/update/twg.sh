#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ $# -gt 1 ]]; then
  printf 'usage: mise run update:twg -- [version]\n' >&2
  exit 64
fi
version=${1:-}
if [[ -z $version ]]; then
  installer=$(curl -fsSL https://teamwork-graph.atlassian.com/cli/install.sh)
  version=$(sed -nE 's/^DEFAULT_VERSION="?([^"[:space:]]+)"?.*/\1/p' <<<"$installer" | head -1)
fi
[[ -n $version ]] || {
  printf 'error: unable to determine the current TWG version\n' >&2
  exit 65
}

checksums=$(curl -fsSL "https://teamwork-graph.atlassian.com/cli/SHA256SUMS-v$version")
hash_darwin_arm64=''
hash_darwin_x64=''
hash_linux_arm64=''
hash_linux_x64=''
for artifact in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
  hash=$(awk -v name="twg-$artifact-v$version" '$2 == name || $2 == "*" name { print $1 }' <<<"$checksums")
  [[ $hash =~ ^[0-9a-fA-F]{64}$ ]] || {
    printf 'error: missing checksum for twg-%s-v%s\n' "$artifact" "$version" >&2
    exit 65
  }
  printf -v "hash_${artifact//-/_}" '%s' "${hash,,}"
done

python3 - "$repo_root/mise.work-macos.toml" "$repo_root/mise.work-macos.lock" "$version" \
  "$hash_darwin_arm64" "$hash_darwin_x64" "$hash_linux_arm64" "$hash_linux_x64" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
lock_path = Path(sys.argv[2])
version = sys.argv[3]
hashes = dict(zip(("macos-arm64", "macos-x64", "linux-arm64", "linux-x64"), sys.argv[4:]))
text = path.read_text()
block_start = text.index('[tools."http:twg"]')
block_end = text.index("\n[bootstrap.packages]", block_start)
block = text[block_start:block_end]
block, count = re.subn(
    r'(\[tools\."http:twg"\]\nversion = ")[^"]+("\n)',
    rf'\g<1>{version}\g<2>',
    block,
    count=1,
)
if count != 1:
    raise SystemExit("TWG tool block not found")
artifacts = {
    "macos-arm64": "darwin-arm64",
    "macos-x64": "darwin-x64",
    "linux-arm64": "linux-arm64",
    "linux-x64": "linux-x64",
}
for platform, artifact in artifacts.items():
    replacement = (
        f'{platform} = {{ url = "https://teamwork-graph.atlassian.com/cli/'
        f'twg-{artifact}-v{version}", checksum = "sha256:{hashes[platform]}" }}'
    )
    block, count = re.subn(rf'^{re.escape(platform)} = .*$', replacement, block, count=1, flags=re.M)
    if count != 1:
        raise SystemExit(f"TWG platform row not found: {platform}")
text = text[:block_start] + block + text[block_end:]
path.write_text(text)

lock = lock_path.read_text()
lock, count = re.subn(
    r'(\[\[tools\."http:twg"\]\]\nversion = ")[^"]+("\n)',
    rf'\g<1>{version}\g<2>',
    lock,
    count=1,
)
if count != 1:
    raise SystemExit("TWG lock block not found")
for platform, artifact in artifacts.items():
    block_pattern = (
        rf'(\[tools\."http:twg"\."platforms\.{re.escape(platform)}"\]\n)'
        rf'checksum = "[^"]+"\nurl = "[^"]+"'
    )
    replacement = (
        rf'\g<1>checksum = "sha256:{hashes[platform]}"\n'
        f'url = "https://teamwork-graph.atlassian.com/cli/twg-{artifact}-v{version}"'
    )
    lock, count = re.subn(block_pattern, replacement, lock, count=1)
    if count != 1:
        raise SystemExit(f"TWG lock platform block not found: {platform}")
lock_path.write_text(lock)
PY

printf 'Updated TWG metadata to %s. Setup and authentication remain manual.\n' "$version"
