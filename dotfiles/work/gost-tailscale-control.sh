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

render_relay_node() {
  cat <<EOF
          - name: authenticated-websocket
            addr: "gost.diloreto.com:443"
            connector:
              type: http
            dialer:
              type: wss
              metadata:
                host: gost.diloreto.com
                path: /tailscale-control
                keepAlive: true
                ttl: 15s
                header:
                  Authorization: "Basic ${authorization}"
            tls:
              serverName: gost.diloreto.com
EOF
}

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
  - name: browser-relay-local
    addr: "127.0.0.1:1056"
    handler:
      type: http
      chain: browser-relay
    listener:
      type: tcp

chains:
  - name: tailscale-control-relay
    hops:
      - name: home-lab-selective
        # Only these destinations use the authenticated remote relay.
        # Other requests through this loopback proxy exit directly from this Mac.
        bypass: relay-destinations
        nodes:
$(render_relay_node)
  - name: browser-relay
    hops:
      - name: home-lab-all
        # Every request through this loopback proxy uses the authenticated remote relay
        # with no direct fallback if the relay is unavailable.
        nodes:
$(render_relay_node)

bypasses:
  - name: relay-destinations
    whitelist: true
    matchers:
      - "tailscale.com:80"
      - "tailscale.com:443"
      - "*.tailscale.com:80"
      - "*.tailscale.com:443"
      - "*.ts.diloreto.com:443"
EOF
}

# GOST does not interpolate environment variables in YAML. Feed the generated
# configuration through inherited stdin so the Authentik app password is absent
# from launchd plists, argv, and persistent plaintext files. The explicit "-"
# tells GOST to parse stdin as YAML; an extensionless /dev/fd path is unsupported.
exec "$gost_bin" -C - < <(render_config)
