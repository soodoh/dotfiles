#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
export COREPACK_ENABLE_PROJECT_SPEC=1

npm ci --ignore-scripts --no-audit --no-fund
npm --prefix pi-extensions ci --legacy-peer-deps --no-audit --no-fund
node scripts/bootstrap/pi-extensions.mjs --check
npm --prefix pi-extensions run ci

npm --prefix packages/work-mcp-servers ci --no-audit --no-fund
MISE_ENV=personal-macos node scripts/bootstrap/validate-agents.mjs
MISE_ENV=work-macos node scripts/bootstrap/validate-agents.mjs

(
  cd pi-extensions
  node --input-type=module <<'NODE'
for (const name of [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
]) {
  await import(name);
}
NODE
)
pi-extensions/node_modules/.bin/pi --version | grep -Fx '0.84.2' >/dev/null
pi-extensions/node_modules/.bin/pi --help >/dev/null

node dotfiles/common/.config/tmux/scripts/pi-session-lib.test.mjs
node dotfiles/profiles/work/.pi/workflows/saved/review-loop.test.mjs

security_log=$(mktemp)
trap 'rm -f "$security_log"' EXIT
if node dotfiles/profiles/work/.pi/agent/settings.security.test.mjs >"$security_log" 2>&1; then
  printf 'error: expected work HTTP security test to fail\n' >&2
  cat "$security_log" >&2
  exit 1
fi
grep -F 'FAIL default provider does not use a cleartext HTTP endpoint' "$security_log" >/dev/null

if [[ ${VALIDATE_READSEEK:-0} == 1 ]]; then
  scripts/bootstrap/validate-readseek.sh
fi
