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

grep -Fq 'addr: "127.0.0.1:1055"' <<<"$output"
grep -Fq 'addr: "gost.diloreto.com:443"' <<<"$output"
grep -Fq 'path: /tailscale-control' <<<"$output"
grep -Fq 'host: gost.diloreto.com' <<<"$output"
grep -Fq 'serverName: gost.diloreto.com' <<<"$output"
grep -Fq "Authorization: \"Basic $expected\"" <<<"$output"
if grep -Fq 'test-app-password' <<<"$output"; then
  printf 'plaintext app password leaked into rendered configuration\n' >&2
  exit 1
fi

if env -u GOST_AUTH_PASSWORD PATH="$work/bin:$PATH" GOST_AUTH_USERNAME=gost-proxy-user \
  bash "$root/dotfiles/work/gost-tailscale-control.sh" >/dev/null 2>&1; then
  printf 'expected missing GOST_AUTH_PASSWORD to fail\n' >&2
  exit 1
fi
