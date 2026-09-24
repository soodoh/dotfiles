#!/usr/bin/env bash
set -euo pipefail

# No automatic bootstrap mutation: the operator supplies one observed network service.
action=${1:?Usage: configure.sh enable|disable NETWORK_SERVICE}
service=${2:?Usage: configure.sh enable|disable NETWORK_SERVICE}
url=http://127.0.0.1:1056/cli-proxy.pac

current=$(networksetup -getautoproxyurl "$service")
if [[ $action == enable ]]; then
  for kind in getwebproxy getsecurewebproxy; do
    setting=$(networksetup "-$kind" "$service")
    if ! grep -Eq '^Enabled: No$' <<<"$setting"; then
      printf 'Refusing PAC activation: an existing web proxy is enabled\n' >&2
      exit 1
    fi
  done
  discovery=$(networksetup -getproxyautodiscovery "$service")
  if ! grep -Eiq '^(Auto Proxy Discovery|Enabled): (Off|No)$' <<<"$discovery"; then
    printf 'Refusing PAC activation: proxy autodiscovery is enabled or unknown\n' >&2
    exit 1
  fi
  # A previously configured PAC belongs to its owner, not to this task.
  if [[ $current != $'Enabled: Yes\nURL: '"$url" &&
        $current != $'Enabled: No\nURL: '"$url" ]] &&
     { ! grep -Eq '^Enabled: No$' <<<"$current" ||
       ! grep -Eq '^URL:[[:space:]]*$' <<<"$current"; }; then
    printf 'Refusing PAC activation: existing PAC state is not disabled and empty\n' >&2
    exit 1
  fi
  curl --noproxy '*' --fail --silent --show-error --max-time 5 \
    --output /dev/null "$url"
  observed=$(curl --proxy http://127.0.0.1:1055 --noproxy '' \
    --silent --show-error --connect-timeout 10 --max-time 30 \
    --output /dev/null \
    --write-out '%{http_connect} %{http_code} %{ssl_verify_result}' \
    https://docker-host.tailea1a78.ts.net:8444/v1/models)
  if [[ $observed != '200 401 0' ]]; then
    printf 'Refusing PAC activation: CLIProxyAPI relay did not pass the unauthenticated check\n' >&2
    exit 1
  fi
  if [[ $current == $'Enabled: Yes\nURL: '"$url" ]]; then
    printf 'PAC already enabled for %s\n' "$service"
    exit 0
  fi
  if [[ $current != $'Enabled: No\nURL: '"$url" ]]; then
    sudo networksetup -setautoproxyurl "$service" "$url"
  fi
  if ! sudo networksetup -setautoproxystate "$service" on ||
     [[ $(networksetup -getautoproxyurl "$service") != $'Enabled: Yes\nURL: '"$url" ]]; then
    sudo networksetup -setautoproxystate "$service" off
    printf 'PAC verification failed; disabled automatic proxy configuration\n' >&2
    exit 1
  fi
  printf 'PAC enabled for %s; test Chrome/Safari and an unrelated site now\n' "$service"
elif [[ $action == disable ]]; then
  if [[ $current != $'Enabled: Yes\nURL: '"$url" &&
        $current != $'Enabled: No\nURL: '"$url" ]]; then
    printf 'Refusing to disable a PAC URL not owned by this task\n' >&2
    exit 1
  fi
  sudo networksetup -setautoproxystate "$service" off
  printf 'PAC disabled for %s (the inactive URL remains configured)\n' "$service"
else
  printf 'Usage: configure.sh enable|disable NETWORK_SERVICE\n' >&2
  exit 64
fi
