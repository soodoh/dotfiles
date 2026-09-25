#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
export PAC_TEST_STATE="$work/state" PAC_TEST_ACTIONS="$work/actions"

state_file() {
  printf '%s.%s' "$PAC_TEST_STATE" "${1// /_}"
}

cat >"$work/bin/networksetup" <<'EOF'
#!/usr/bin/env bash
state_file() { printf '%s.%s' "$PAC_TEST_STATE" "${1// /_}"; }
case $1 in
  -listallnetworkservices)
    printf 'An asterisk (*) denotes that a network service is disabled.\n'
    case ${PAC_TEST_SERVICES:-both} in
      both) printf 'Wi-Fi\nThunderbolt Ethernet Slot 0\n' ;;
      wifi) printf 'Wi-Fi\n' ;;
      ethernet) printf 'Thunderbolt Ethernet Slot 0\n' ;;
      disabled) printf '*Wi-Fi\nThunderbolt Ethernet Slot 0\n' ;;
      none) : ;;
    esac ;;
  -getautoproxyurl)
    service=$2
    case $(<"$(state_file "$service")") in
      empty) printf 'URL: \nEnabled: No\n' ;;
      active) printf 'URL: http://127.0.0.1:1056/cli-proxy.pac\nEnabled: Yes\n' ;;
      inactive) printf 'URL: http://127.0.0.1:1056/cli-proxy.pac\nEnabled: No\n' ;;
      foreign) printf 'URL: https://corporate.example.test/proxy.pac\nEnabled: Yes\n' ;;
    esac ;;
  -getwebproxy|-getsecurewebproxy)
    if [[ ${PAC_TEST_MANUAL:-} == yes ]]; then printf 'Enabled: Yes\n'
    else printf 'Enabled: No\n'; fi ;;
  -getproxyautodiscovery)
    if [[ ${PAC_TEST_DISCOVERY:-} == yes ]]; then printf 'Auto Proxy Discovery: On\n'
    else printf 'Auto Proxy Discovery: Off\n'; fi ;;
  *) exit 1 ;;
esac
EOF
cat >"$work/bin/sudo" <<'EOF'
#!/usr/bin/env bash
state_file() { printf '%s.%s' "$PAC_TEST_STATE" "${1// /_}"; }
[[ $1 == networksetup ]] || exit 1
option=$2
service=$3
printf '%s %s\n' "$option" "$service" >>"$PAC_TEST_ACTIONS"
case $option in
  -setautoproxyurl) printf 'active\n' >"$(state_file "$service")" ;;
  -setautoproxystate)
    if [[ $4 == on && ${PAC_TEST_FAIL_SERVICE:-} == "$service" ]]; then exit 1; fi
    if [[ $4 == on ]]; then printf 'active\n' >"$(state_file "$service")"
    else printf 'inactive\n' >"$(state_file "$service")"; fi ;;
  *) exit 1 ;;
esac
EOF
cat >"$work/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ ${PAC_TEST_CURL_FAIL:-} == yes ]]; then exit 7; fi
if [[ " $* " == *' --write-out '* ]]; then printf '200 401 0'; fi
EOF
chmod 700 "$work/bin/"*
export PATH="$work/bin:$PATH"
script="$root/dotfiles/work/pac/configure.sh"

for service in 'Wi-Fi' 'Thunderbolt Ethernet Slot 0'; do
  printf 'empty\n' >"$(state_file "$service")"
done
bash "$script" >/dev/null
[[ $(<"$(state_file 'Wi-Fi')") == active ]]
[[ $(<"$(state_file 'Thunderbolt Ethernet Slot 0')") == active ]]
[[ $(wc -l <"$PAC_TEST_ACTIONS") -eq 4 ]]
bash "$script" disable >/dev/null
[[ $(<"$(state_file 'Wi-Fi')") == inactive ]]
[[ $(<"$(state_file 'Thunderbolt Ethernet Slot 0')") == inactive ]]
[[ $(wc -l <"$PAC_TEST_ACTIONS") -eq 6 ]]
bash "$script" >/dev/null
[[ $(wc -l <"$PAC_TEST_ACTIONS") -eq 8 ]]

: >"$PAC_TEST_ACTIONS"
printf 'foreign\n' >"$(state_file 'Wi-Fi')"
printf 'empty\n' >"$(state_file 'Thunderbolt Ethernet Slot 0')"
if bash "$script" >/dev/null 2>&1 || [[ -s $PAC_TEST_ACTIONS ]]; then
  printf 'existing corporate PAC was not preserved\n' >&2
  exit 1
fi

for service in 'Wi-Fi' 'Thunderbolt Ethernet Slot 0'; do
  printf 'empty\n' >"$(state_file "$service")"
done
if PAC_TEST_CURL_FAIL=yes bash "$script" >/dev/null 2>&1 || [[ -s $PAC_TEST_ACTIONS ]]; then
  printf 'unavailable PAC server was not rejected\n' >&2
  exit 1
fi

for condition in PAC_TEST_MANUAL PAC_TEST_DISCOVERY; do
  : >"$PAC_TEST_ACTIONS"
  if env "$condition=yes" bash "$script" >/dev/null 2>&1 || [[ -s $PAC_TEST_ACTIONS ]]; then
    printf 'pre-existing proxy settings were not preserved\n' >&2
    exit 1
  fi
done

: >"$PAC_TEST_ACTIONS"
printf 'empty\n' >"$(state_file 'Wi-Fi')"
printf 'active\n' >"$(state_file 'Thunderbolt Ethernet Slot 0')"
PAC_TEST_SERVICES=wifi bash "$script" >/dev/null 2>"$work/warning"
grep -Fq 'Warning: network service Thunderbolt Ethernet Slot 0 is missing; skipping' "$work/warning"
[[ $(<"$(state_file 'Wi-Fi')") == active ]]
[[ $(<"$(state_file 'Thunderbolt Ethernet Slot 0')") == active ]]
[[ $(wc -l <"$PAC_TEST_ACTIONS") -eq 2 ]]

: >"$PAC_TEST_ACTIONS"
printf 'empty\n' >"$(state_file 'Thunderbolt Ethernet Slot 0')"
PAC_TEST_SERVICES=ethernet bash "$script" >/dev/null 2>"$work/warning"
grep -Fq 'Warning: network service Wi-Fi is missing; skipping' "$work/warning"
[[ $(<"$(state_file 'Thunderbolt Ethernet Slot 0')") == active ]]
[[ $(wc -l <"$PAC_TEST_ACTIONS") -eq 2 ]]

: >"$PAC_TEST_ACTIONS"
if PAC_TEST_SERVICES=none bash "$script" >/dev/null 2>"$work/warning" || [[ -s $PAC_TEST_ACTIONS ]]; then
  printf 'expected no-service activation to fail without changes\n' >&2
  exit 1
fi
grep -Fq 'Warning: network service Wi-Fi is missing; skipping' "$work/warning"
grep -Fq 'Warning: network service Thunderbolt Ethernet Slot 0 is missing; skipping' "$work/warning"

: >"$PAC_TEST_ACTIONS"
printf 'empty\n' >"$(state_file 'Wi-Fi')"
printf 'foreign\n' >"$(state_file 'Thunderbolt Ethernet Slot 0')"
if bash "$script" >/dev/null 2>&1 || [[ -s $PAC_TEST_ACTIONS ]]; then
  printf 'a foreign PAC on the second service was not preserved\n' >&2
  exit 1
fi

: >"$PAC_TEST_ACTIONS"
printf 'empty\n' >"$(state_file 'Wi-Fi')"
printf 'empty\n' >"$(state_file 'Thunderbolt Ethernet Slot 0')"
if PAC_TEST_FAIL_SERVICE='Thunderbolt Ethernet Slot 0' bash "$script" >/dev/null 2>&1; then
  printf 'expected second-service activation to fail\n' >&2
  exit 1
fi
[[ $(<"$(state_file 'Wi-Fi')") == inactive ]]
[[ $(<"$(state_file 'Thunderbolt Ethernet Slot 0')") == inactive ]]

: >"$PAC_TEST_ACTIONS"
printf 'active\n' >"$(state_file 'Wi-Fi')"
printf 'empty\n' >"$(state_file 'Thunderbolt Ethernet Slot 0')"
if PAC_TEST_FAIL_SERVICE='Thunderbolt Ethernet Slot 0' bash "$script" >/dev/null 2>&1; then
  printf 'expected second-service activation to fail\n' >&2
  exit 1
fi
[[ $(<"$(state_file 'Wi-Fi')") == active ]]
[[ $(<"$(state_file 'Thunderbolt Ethernet Slot 0')") == inactive ]]

printf 'work PAC configuration helper tests passed\n'
