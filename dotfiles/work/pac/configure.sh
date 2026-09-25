#!/usr/bin/env bash
set -euo pipefail

# Opt-in only: never change system proxies during bootstrap.
action=${1:-enable}
if (( $# > 1 )) || [[ $action != enable && $action != disable ]]; then
  printf 'Usage: configure.sh [enable|disable]\n' >&2
  exit 64
fi
url=http://127.0.0.1:1056/cli-proxy.pac
services=("Wi-Fi" "Thunderbolt Ethernet Slot 0")
targets=()
prior_urls=()
prior_enabled=()
changed=()

# networksetup prints URL before Enabled on this Mac. Parse fields independently.
read_pac_state() {
  local output line
  output=$(networksetup -getautoproxyurl "$1")
  pac_url= pac_enabled=
  while IFS= read -r line; do
    case $line in
      'URL: '*) pac_url=${line#'URL: '} ;;
      'Enabled: Yes') pac_enabled=Yes ;;
      'Enabled: No') pac_enabled=No ;;
      *) printf 'Unexpected PAC state for %s: %s\n' "$1" "$line" >&2; return 1 ;;
    esac
  done <<<"$output"
  if [[ -z $pac_enabled ]]; then
    printf 'Missing PAC state for %s\n' "$1" >&2
    return 1
  fi
}

listed=$(networksetup -listallnetworkservices)
for service in "${services[@]}"; do
  found=false
  while IFS= read -r entry; do
    if [[ ${entry#\*} == "$service" ]]; then
      found=true
      break
    fi
  done <<<"$listed"
  if [[ $found == false ]]; then
    printf 'Warning: network service %s is missing; skipping\n' "$service" >&2
    continue
  fi
  targets+=("$service")
done
if [[ ${#targets[@]} -eq 0 ]]; then
  printf 'No allow-listed network services found; PAC unchanged\n' >&2
  exit 1
fi

# Preflight every existing service before changing any of them.
for service in "${targets[@]}"; do
  read_pac_state "$service"
  prior_urls+=("$pac_url")
  prior_enabled+=("$pac_enabled")
  if [[ ( -n $pac_url && $pac_url != "$url" ) || ( $pac_enabled == Yes && -z $pac_url ) ]]; then
    printf 'Refusing to %s PAC: %s has a different PAC URL\n' "$action" "$service" >&2
    exit 1
  fi
  if [[ $action == enable ]]; then
    for kind in getwebproxy getsecurewebproxy; do
      setting=$(networksetup "-$kind" "$service")
      if ! grep -Eq '^Enabled: No$' <<<"$setting"; then
        printf 'Refusing PAC activation: %s has an existing web proxy\n' "$service" >&2
        exit 1
      fi
    done
    discovery=$(networksetup -getproxyautodiscovery "$service")
    if ! grep -Eiq '^(Auto Proxy Discovery|Enabled): (Off|No)$' <<<"$discovery"; then
      printf 'Refusing PAC activation: %s has proxy autodiscovery enabled or unknown\n' "$service" >&2
      exit 1
    fi
  fi
done

if [[ $action == enable ]]; then
  curl --noproxy '*' --fail --silent --show-error --max-time 5 \
    --output /dev/null "$url"
  observed=$(curl --proxy http://127.0.0.1:1055 --noproxy '' \
    --silent --show-error --connect-timeout 10 --max-time 30 \
    --output /dev/null \
    --write-out '%{http_connect} %{http_code} %{ssl_verify_result}' \
    https://docker-host.mora-rattlesnake.ts.net:8444/v1/models)
  if [[ $observed != '200 401 0' ]]; then
    printf 'Refusing PAC activation: CLIProxyAPI relay did not pass the unauthenticated check\n' >&2
    exit 1
  fi

  for index in "${!targets[@]}"; do
    service=${targets[$index]}
    if [[ ${prior_enabled[$index]} == Yes ]]; then
      printf 'PAC already enabled for %s\n' "$service"
      continue
    fi
    # -setautoproxyurl itself enables the PAC. Remember the service before writing.
    changed+=("$service")
    if { [[ ${prior_urls[$index]} != "$url" ]] &&
         ! sudo networksetup -setautoproxyurl "$service" "$url"; } ||
       ! sudo networksetup -setautoproxystate "$service" on ||
       ! read_pac_state "$service" ||
       [[ $pac_enabled != Yes || $pac_url != "$url" ]]; then
      printf 'PAC activation failed for %s; disabling services changed in this run\n' "$service" >&2
      for changed_service in "${changed[@]}"; do
        if ! sudo networksetup -setautoproxystate "$changed_service" off; then
          printf 'Warning: could not disable PAC for %s; inspect it manually\n' "$changed_service" >&2
        fi
      done
      exit 1
    fi
    printf 'PAC enabled for %s\n' "$service"
  done
  printf 'Test Chrome, Zen, Firefox and Safari against tailnet and unrelated sites now\n'
else
  for index in "${!targets[@]}"; do
    service=${targets[$index]}
    if [[ ${prior_urls[$index]} != "$url" ]]; then
      printf 'PAC not managed for %s; leaving it unchanged\n' "$service"
      continue
    fi
    if [[ ${prior_enabled[$index]} == No ]]; then
      printf 'PAC already disabled for %s\n' "$service"
      continue
    fi
    sudo networksetup -setautoproxystate "$service" off
    read_pac_state "$service"
    if [[ $pac_enabled != No || $pac_url != "$url" ]]; then
      printf 'PAC disable verification failed for %s; inspect it manually\n' "$service" >&2
      exit 1
    fi
    printf 'PAC disabled for %s (the inactive URL remains configured)\n' "$service"
  done
fi
