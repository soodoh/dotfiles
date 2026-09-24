#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
export PAC_TEST_STATE="$work/state" PAC_TEST_ACTIONS="$work/actions"

cat >"$work/bin/networksetup" <<'EOF'
#!/usr/bin/env bash
case $1 in
  -getautoproxyurl)
    case $(<"$PAC_TEST_STATE") in
      empty) printf 'Enabled: No\nURL: \n' ;;
      active) printf 'Enabled: Yes\nURL: http://127.0.0.1:1056/cli-proxy.pac\n' ;;
      inactive) printf 'Enabled: No\nURL: http://127.0.0.1:1056/cli-proxy.pac\n' ;;
      foreign) printf 'Enabled: Yes\nURL: https://corporate.example.test/proxy.pac\n' ;;
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
[[ $1 == networksetup && $3 == "Wi-Fi" ]] || exit 1
printf '%s\n' "$2" >>"$PAC_TEST_ACTIONS"
case $2 in
  -setautoproxyurl) printf 'inactive\n' >"$PAC_TEST_STATE" ;;
  -setautoproxystate)
    if [[ $4 == on ]]; then printf 'active\n' >"$PAC_TEST_STATE"
    else printf 'inactive\n' >"$PAC_TEST_STATE"; fi ;;
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

printf 'empty\n' >"$PAC_TEST_STATE"
bash "$script" enable Wi-Fi >/dev/null
[[ $(<"$PAC_TEST_STATE") == active ]]
[[ $(wc -l <"$PAC_TEST_ACTIONS") -eq 2 ]]
bash "$script" disable Wi-Fi >/dev/null
[[ $(<"$PAC_TEST_STATE") == inactive ]]
[[ $(wc -l <"$PAC_TEST_ACTIONS") -eq 3 ]]
bash "$script" enable Wi-Fi >/dev/null
[[ $(<"$PAC_TEST_STATE") == active ]]
[[ $(wc -l <"$PAC_TEST_ACTIONS") -eq 4 ]]

: >"$PAC_TEST_ACTIONS"
printf 'foreign\n' >"$PAC_TEST_STATE"
if bash "$script" enable Wi-Fi >/dev/null 2>&1 || [[ -s $PAC_TEST_ACTIONS ]]; then
  printf 'existing corporate PAC was not preserved\n' >&2
  exit 1
fi
printf 'empty\n' >"$PAC_TEST_STATE"
if PAC_TEST_CURL_FAIL=yes bash "$script" enable Wi-Fi >/dev/null 2>&1 || [[ -s $PAC_TEST_ACTIONS ]]; then
  printf 'unavailable PAC server was not rejected\n' >&2
  exit 1
fi
for condition in PAC_TEST_MANUAL PAC_TEST_DISCOVERY; do
  if env "$condition=yes" bash "$script" enable Wi-Fi >/dev/null 2>&1 || [[ -s $PAC_TEST_ACTIONS ]]; then
    printf 'pre-existing proxy settings were not preserved\n' >&2
    exit 1
  fi
done
printf 'active\n' >"$PAC_TEST_STATE"
if PAC_TEST_CURL_FAIL=yes bash "$script" enable Wi-Fi >/dev/null 2>&1 || [[ -s $PAC_TEST_ACTIONS ]]; then
  printf 'unavailable PAC server was accepted as healthy\n' >&2
  exit 1
fi
