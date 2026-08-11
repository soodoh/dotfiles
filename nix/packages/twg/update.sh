#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
installer="$(mktemp)"
trap 'rm -f "$installer"' EXIT
curl -fsSL https://teamwork-graph.atlassian.com/cli/install > "$installer"
version="${1:-$(sed -n 's/^DEFAULT_VERSION="\([^"]*\)"/\1/p' "$installer")}"
checksums="$(curl -fsSL "https://teamwork-graph.atlassian.com/cli/SHA256SUMS-v${version}")"
python3 - "$version" "$checksums" <<'PY'
from pathlib import Path
import base64, re, sys
version, checksums = sys.argv[1:]
entries = dict(line.split(maxsplit=1) for line in checksums.splitlines() if line.strip())
artifacts = {
    "aarch64-darwin": f"twg-darwin-arm64-v{version}",
    "x86_64-darwin": f"twg-darwin-x64-v{version}",
    "aarch64-linux": f"twg-linux-arm64-v{version}",
    "x86_64-linux": f"twg-linux-x64-v{version}",
}
path = Path("default.nix")
text = path.read_text()
text = re.sub(r'version = "[^"]+";', f'version = "{version}";', text, count=1)
for system, artifact in artifacts.items():
    sri = "sha256-" + base64.b64encode(bytes.fromhex(entries[artifact])).decode()
    pattern = rf'({re.escape(system)} = \{{.*?hash = ")[^"]+(";)'
    text, count = re.subn(pattern, rf'\g<1>{sri}\2', text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"could not update {system}")
path.write_text(text)
PY
printf 'Updated TWG to %s; setup/authentication were not run\n' "$version"
