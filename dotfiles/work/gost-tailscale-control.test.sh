#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"

cat >"$work/bin/gost" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ $1 == -C && ${2:-} == - ]]
[[ $* != *test-app-password* ]]
[[ -z ${GOST_AUTH_USERNAME+x} && -z ${GOST_AUTH_PASSWORD+x} ]]
cat
EOF
chmod 0755 "$work/bin/gost"

output=$(
  PATH="$work/bin:$PATH" \
  GOST_AUTH_USERNAME=gost-proxy-user \
  GOST_AUTH_PASSWORD=test-app-password \
    bash "$root/dotfiles/work/gost-tailscale-control.sh"
)
expected=$(printf '%s' 'gost-proxy-user:test-app-password' | base64 | tr -d '\n')

printf '%s\n' "$output" >"$work/rendered.yaml"
python3 - "$root/dotfiles/work/mise-credentials.toml" "$work/rendered.yaml" "$expected" <<'PY'
import re
import sys
import tomllib
from pathlib import Path
from urllib.parse import urlsplit

with open(sys.argv[1], "rb") as source:
    proxy = urlsplit(tomllib.load(source)["env"]["HTTP_PROXY"])
rendered = Path(sys.argv[2]).read_text()
expected_auth = sys.argv[3]

if "test-app-password" in rendered:
    raise SystemExit("plaintext app password leaked into rendered configuration")

def split_items(section: str) -> dict[str, str]:
    match = re.search(rf"(?ms)^{section}:\n(.*?)(?=^\S|\Z)", rendered)
    if not match:
        raise SystemExit(f"missing {section} section")
    items = {}
    for block in re.split(r"(?m)^  - name: ", match.group(1))[1:]:
        name, body = block.split("\n", 1)
        items[name.strip()] = body
    return items

services = split_items("services")
chains = split_items("chains")
bypasses = split_items("bypasses")

assert set(services) == {"tailscale-control-local", "browser-relay-local"}, services
assert f'addr: "{proxy.netloc}"' in services["tailscale-control-local"]
assert "chain: tailscale-control-relay" in services["tailscale-control-local"]

browser_addr_match = re.search(r'addr: "([^"]+)"', services["browser-relay-local"])
assert browser_addr_match, "browser-relay-local missing addr"
browser_addr = browser_addr_match.group(1)
assert browser_addr.startswith("127.0.0.1:"), f"expected loopback browser listener, got {browser_addr}"
assert browser_addr != proxy.netloc, "browser listener must not collide with HTTP_PROXY listener"
assert "chain: browser-relay" in services["browser-relay-local"]

assert set(chains) == {"tailscale-control-relay", "browser-relay"}, chains
assert "bypass: relay-destinations" in chains["tailscale-control-relay"]
assert "bypass:" not in chains["browser-relay"], "browser-relay must not bypass to direct"

for name, body in chains.items():
    for expected_line in (
        'addr: "gost.diloreto.com:443"',
        "path: /tailscale-control",
        "host: gost.diloreto.com",
        "serverName: gost.diloreto.com",
        f'Authorization: "Basic {expected_auth}"',
    ):
        assert expected_line in body, f"{name} missing {expected_line}"

relay_bypass = bypasses["relay-destinations"]
assert "whitelist: true" in relay_bypass
actual_matchers = re.findall(r'^      - "([^"]+)"$', relay_bypass, re.MULTILINE)
expected_matchers = [
    "tailscale.com:80",
    "tailscale.com:443",
    "*.tailscale.com:80",
    "*.tailscale.com:443",
    "*.ts.diloreto.com:443",
]
if actual_matchers != expected_matchers:
    raise SystemExit(f"work proxy relay destinations differ from the approved whitelist: {actual_matchers}")
PY

if env -u GOST_AUTH_PASSWORD PATH="$work/bin:$PATH" GOST_AUTH_USERNAME=gost-proxy-user \
  bash "$root/dotfiles/work/gost-tailscale-control.sh" >/dev/null 2>&1; then
  printf 'expected missing GOST_AUTH_PASSWORD to fail\n' >&2
  exit 1
fi
