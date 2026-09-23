#!/usr/bin/env bash
set -euo pipefail

: "${GOST_AUTH_USERNAME:?Set GOST_AUTH_USERNAME in the work-macos mise environment}"
: "${GOST_AUTH_PASSWORD:?Set GOST_AUTH_PASSWORD in the work-macos mise environment}"

if [[ $GOST_AUTH_USERNAME == *:* || $GOST_AUTH_USERNAME == *$'\n'* ]]; then
  printf 'error: GOST_AUTH_USERNAME cannot contain a colon or newline\n' >&2
  exit 64
fi

gost_bin=$(command -v gost) || {
  printf 'error: gost is not installed\n' >&2
  exit 69
}
authorization=$(printf '%s:%s' "$GOST_AUTH_USERNAME" "$GOST_AUTH_PASSWORD" | base64 | tr -d '\n')
unset GOST_AUTH_USERNAME GOST_AUTH_PASSWORD

render_config() {
  cat <<EOF
services:
  - name: tailscale-control-local
    addr: "127.0.0.1:1055"
    handler:
      type: http
      chain: tailscale-control-relay
    listener:
      type: tcp

chains:
  - name: tailscale-control-relay
    hops:
      - name: home-lab
        nodes:
          - name: authenticated-websocket
            addr: "ts-control.diloreto.com:443"
            connector:
              type: http
            dialer:
              type: wss
              metadata:
                host: ts-control.diloreto.com
                path: /tailscale-control
                keepAlive: true
                ttl: 15s
                header:
                  Authorization: "Basic ${authorization}"
            tls:
              serverName: ts-control.diloreto.com
EOF
}

# GOST does not interpolate environment variables in YAML. Feed the generated
# configuration through inherited stdin so the Authentik app password is absent
# from launchd plists, argv, and persistent plaintext files. The explicit "-"
# tells GOST to parse stdin as YAML; an extensionless /dev/fd path is unsupported.
exec "$gost_bin" -C - < <(render_config)
