#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
version="${1:-$(npm view @jarkkojs/readseek version)}"
jq --arg version "$version" '.version = $version | .dependencies["@jarkkojs/readseek"] = $version' package.json > package.json.tmp
mv package.json.tmp package.json
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
node ../fix-npm-lock-integrity.mjs package-lock.json
hash="$(nix run ../../..#prefetch-npm-deps -- package-lock.json)"
python3 - "$version" "$hash" <<'PY'
from pathlib import Path
import re, sys
path = Path("default.nix")
text = path.read_text()
text = re.sub(r'version = "[^"]+";', f'version = "{sys.argv[1]}";', text, count=1)
text = re.sub(r'npmDepsHash = "[^"]+";', f'npmDepsHash = "{sys.argv[2]}";', text, count=1)
path.write_text(text)
PY
printf 'Updated ReadSeek to %s (%s)\n' "$version" "$hash"
