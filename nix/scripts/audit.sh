set -euo pipefail
host="${1:-}"
mode="${2:-}"
if [ -z "$host" ]; then
  echo >&2 "usage: nix-audit <host> [--json]"
  exit 2
fi
host_json="$(jq -c --arg host "$host" '.[$host] // empty' "$NIX_DOTFILES_HOSTS_JSON")"
if [ -z "$host_json" ]; then
  echo >&2 "unknown host: $host"
  exit 2
fi

json_lines() {
  jq -Rsc 'split("\n") | map(select(length > 0))'
}

nix_profile='{}'
if command -v nix >/dev/null 2>&1; then
  nix_profile="$(nix profile list --json 2>/dev/null || printf '{}')"
fi
brew_formulae='[]'; brew_casks='[]'; brew_taps='[]'; brew_info='{"casks":[]}'
brew_bin="$(command -v brew 2>/dev/null || true)"
for candidate in "$brew_bin" /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -x "$candidate" ]; then brew_bin="$candidate"; break; fi
done
if [ -n "$brew_bin" ] && [ -x "$brew_bin" ]; then
  brew_formulae="$("$brew_bin" leaves 2>/dev/null | json_lines)"
  brew_casks="$("$brew_bin" list --cask 2>/dev/null | json_lines)"
  brew_taps="$("$brew_bin" tap 2>/dev/null | json_lines)"
  if [ "$(printf '%s' "$brew_casks" | jq length)" -gt 0 ]; then
    mapfile -t installed_casks < <(printf '%s' "$brew_casks" | jq -r '.[]')
    brew_info="$("$brew_bin" info --cask --json=v2 "${installed_casks[@]}" 2>/dev/null || printf '{"casks":[]}')"
  fi
fi

mas_apps='[]'
if command -v mas >/dev/null 2>&1; then
  mas_apps="$(mas list 2>/dev/null | awk '{id=$1; $1=""; sub(/^ +/, ""); sub(/  \([^)]*\)$/, ""); print id "\t" $0}' | jq -Rsc 'split("\n") | map(select(length > 0) | split("\t") | {id:(.[0]|tonumber),name:.[1]})')"
fi

brew_app_names="$(printf '%s' "$brew_info" | jq -r '.casks[]?.artifacts[]? | select(.app?) | (.target // .app[]?) | select(type == "string") | split("/")[-1]' 2>/dev/null || true)"
applications='[]'
if [ "$(uname -s)" = Darwin ]; then
  while IFS= read -r -d '' app; do
    bundle_id="$(mdls -name kMDItemCFBundleIdentifier -raw "$app" 2>/dev/null || true)"
    [ "$bundle_id" = "(null)" ] && bundle_id=""
    app_name="$(basename "$app")"
    case "$app" in
      /System/Applications/*) source="apple-system" ;;
      /Applications/Nix\ Apps/*) source="nix" ;;
      *)
        if printf '%s\n' "$brew_app_names" | grep -Fxq "$app_name"; then source="homebrew";
        elif printf '%s' "$bundle_id" | grep -q '^com\.apple\.'; then source="apple-system";
        else source="manual"; fi
        ;;
    esac
    applications="$(printf '%s' "$applications" | jq --arg path "$app" --arg name "$app_name" --arg bundle "$bundle_id" --arg source "$source" '. + [{path:$path,name:$name,bundleId:$bundle,source:$source}]')"
  done < <(find /Applications "$HOME/Applications" -maxdepth 2 \( -type d -o -type l \) -name '*.app' -print0 2>/dev/null || true)
fi

npm_globals='[]'; bun_globals='[]'; cargo_globals='[]'; uv_globals='[]'
legacy_npm="$HOME/.local/share/fnm/aliases/default/bin/npm"
legacy_node="$(dirname "$legacy_npm")/node"
legacy_bun="$HOME/.bun/bin/bun"
legacy_cargo="$HOME/.cargo/bin/cargo"
legacy_uv="$HOME/.local/bin/uv"
if [ -x "$legacy_npm" ] && [ -x "$legacy_node" ]; then
  if npm_raw="$("$legacy_node" "$legacy_npm" ls -g --depth=0 --json 2>/dev/null)"; then
    npm_globals="$(printf '%s' "$npm_raw" | jq '[.dependencies // {} | keys[]]' 2>/dev/null || printf '[]')"
  fi
fi
if [ -x "$legacy_bun" ]; then
  if bun_raw="$(BUN_INSTALL="$HOME/.bun" "$legacy_bun" pm ls -g 2>/dev/null)"; then
    bun_globals="$(printf '%s\n' "$bun_raw" | sed -E '1d; s/^[^[:space:]]+[[:space:]]+//; s/@[^@[:space:]]+$//' | json_lines)"
  fi
fi
if [ -x "$legacy_cargo" ]; then
  if cargo_raw="$("$legacy_cargo" install --list 2>/dev/null)"; then
    cargo_globals="$(printf '%s\n' "$cargo_raw" | awk '/^[^ ]/ {sub(/ v.*/, ""); print}' | json_lines)"
  fi
fi
if [ -x "$legacy_uv" ]; then
  if uv_raw="$("$legacy_uv" tool list 2>/dev/null)"; then
    uv_globals="$(printf '%s\n' "$uv_raw" | awk '/^[^ -]/ {print $1}' | json_lines)"
  fi
fi

native='{"manager":null,"packages":[]}'
if command -v pacman >/dev/null 2>&1; then
  native="$(pacman -Qqe 2>/dev/null | jq -Rsc '{manager:"pacman",packages:(split("\n")|map(select(length>0)))}')"
elif command -v apt-mark >/dev/null 2>&1; then
  native="$(apt-mark showmanual 2>/dev/null | jq -Rsc '{manager:"apt",packages:(split("\n")|map(select(length>0)))}')"
fi

legacy='[]'
for item in "$HOME/.local/state/dotfiles-ansible" "$HOME/.ansible" "$HOME/.local/share/fnm" "$HOME/.rustup" "$HOME/.bun/install/global"; do
  if [ -e "$item" ]; then legacy="$(printf '%s' "$legacy" | jq --arg item "$item" '. + [$item]')"; fi
done
for command_name in ansible ansible-lint stow fnm rustup; do
  if command -v "$command_name" >/dev/null 2>&1; then
    command_path="$(command -v "$command_name")"
    legacy="$(printf '%s' "$legacy" | jq --arg item "$command_name:$command_path" '. + [$item]')"
  fi
done

report="$(jq -n \
  --arg host "$host" \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson desired "$host_json" \
  --argjson nixProfile "$nix_profile" \
  --argjson formulae "$brew_formulae" \
  --argjson casks "$brew_casks" \
  --argjson taps "$brew_taps" \
  --argjson mas "$mas_apps" \
  --argjson applications "$applications" \
  --argjson npm "$npm_globals" \
  --argjson bun "$bun_globals" \
  --argjson cargo "$cargo_globals" \
  --argjson uv "$uv_globals" \
  --argjson native "$native" \
  --argjson legacy "$legacy" \
  '{schemaVersion:1,host:$host,generatedAt:$generatedAt,desired:$desired,observed:{nixProfile:$nixProfile,homebrew:{formulae:$formulae,casks:$casks,taps:$taps},mas:$mas,applications:$applications,legacyGlobals:{npm:$npm,bun:$bun,cargo:$cargo,uv:$uv},native:$native,legacyArtifacts:$legacy}}')"

state_dir="$HOME/.local/state/dotfiles-nix"
mkdir -p "$state_dir"
printf '%s\n' "$report" > "$state_dir/audit-$host.json"
if [ "$mode" = "--json" ]; then
  printf '%s\n' "$report"
else
  printf '%s\n' "$report" | jq -r '"Audit: \(.host) @ \(.generatedAt)\n  Nix profile entries: \(.observed.nixProfile | length)\n  Homebrew formulae/casks/taps: \(.observed.homebrew.formulae|length)/\(.observed.homebrew.casks|length)/\(.observed.homebrew.taps|length)\n  MAS apps: \(.observed.mas|length)\n  Application bundles: \(.observed.applications|length)\n  Legacy artifacts: \(.observed.legacyArtifacts|length)\n  Native \(.observed.native.manager // "package") packages: \(.observed.native.packages|length) (report only)\nJSON: '"$state_dir/audit-$host.json"'"'
fi
