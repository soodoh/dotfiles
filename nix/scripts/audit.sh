set -euo pipefail

host="${1:-}"
mode="${2:-}"
if [ -z "$host" ] || { [ -n "$mode" ] && [ "$mode" != "--json" ]; }; then
  echo >&2 "usage: nix-audit <host> [--json]"
  exit 2
fi

host_json="$(jq -c --arg host "$host" '.[$host] // empty' "$NIX_DOTFILES_HOSTS_JSON")"
if [ -z "$host_json" ]; then
  echo >&2 "unknown host: $host"
  exit 2
fi

json_lines() {
  jq -Rsc 'split("\n") | map(select(length > 0)) | unique'
}

nix_profile='{}'
if command -v nix >/dev/null 2>&1; then
  nix_profile="$(nix profile list --json 2>/dev/null | jq '.elements // {}' || printf '{}')"
fi

brew_formulae='[]'
brew_casks='[]'
brew_taps='[]'
brew_info='{"casks":[]}'
brew_bin="$(command -v brew 2>/dev/null || true)"
for candidate in "$brew_bin" /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -x "$candidate" ]; then
    brew_bin="$candidate"
    break
  fi
done
if [ -n "$brew_bin" ] && [ -x "$brew_bin" ]; then
  brew_formulae="$("$brew_bin" list --formula 2>/dev/null | json_lines)"
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
mas_ids="$(printf '%s' "$mas_apps" | jq '[.[].id]')"

brew_app_names="$(printf '%s' "$brew_info" | jq -r '.casks[]?.artifacts[]? | select(.app?) | (.target // .app[]?) | select(type == "string") | split("/")[-1]' 2>/dev/null || true)"
applications='[]'
if [ "$(uname -s)" = Darwin ]; then
  while IFS= read -r -d '' app; do
    bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "$app/Contents/Info.plist" 2>/dev/null || true)"
    if [ -z "$bundle_id" ]; then
      bundle_id="$(mdls -name kMDItemCFBundleIdentifier -raw "$app" 2>/dev/null || true)"
      [ "$bundle_id" = "(null)" ] && bundle_id=""
    fi

    store_id="$(mdls -name kMDItemAppStoreAdamID -raw "$app" 2>/dev/null || true)"
    case "$store_id" in
      ''|'(null)'|*[!0-9]*) store_id_json=null ;;
      *) store_id_json="$store_id" ;;
    esac

    app_name="$(basename "$app")"
    case "$app" in
      /System/Applications/*) source="apple-system" ;;
      /Applications/Nix\ Apps/*|"$HOME"/Applications/Home\ Manager\ Apps/*) source="nix" ;;
      *)
        if printf '%s\n' "$brew_app_names" | grep -Fxq "$app_name"; then
          source="homebrew"
        elif [ "$store_id_json" != null ] && printf '%s' "$mas_ids" | jq -e --argjson id "$store_id_json" 'index($id) != null' >/dev/null; then
          source="mas"
        elif printf '%s' "$bundle_id" | grep -q '^com\.apple\.'; then
          source="apple-system"
        else
          source="manual"
        fi
        ;;
    esac

    applications="$(printf '%s' "$applications" | jq \
      --arg path "$app" \
      --arg name "$app_name" \
      --arg bundle "$bundle_id" \
      --arg source "$source" \
      --argjson storeId "$store_id_json" \
      '. + [{path:$path,name:$name,bundleId:$bundle,storeId:$storeId,source:$source}]')"
  done < <(find /Applications "$HOME/Applications" -maxdepth 2 \( -type d -o -type l \) -name '*.app' -print0 2>/dev/null || true)
fi

npm_globals='[]'
bun_globals='[]'
cargo_globals='[]'
uv_globals='[]'
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
if [ -x "$legacy_bun" ] && [ -d "$HOME/.bun/install/global/node_modules" ]; then
  if bun_raw="$(BUN_INSTALL="$HOME/.bun" "$legacy_bun" pm ls -g 2>/dev/null)"; then
    bun_globals="$(printf '%s\n' "$bun_raw" | sed -E '1d; s/^[^[:space:]]+[[:space:]]+//; s/@[^@[:space:]]+$//' | json_lines)"
  fi
fi
cargo_installs="$HOME/.cargo/.crates2.json"
if [ -x "$legacy_cargo" ] && [ -f "$cargo_installs" ] && jq -e '.installs | length > 0' "$cargo_installs" >/dev/null 2>&1; then
  if cargo_raw="$("$legacy_cargo" install --list 2>/dev/null)"; then
    cargo_globals="$(printf '%s\n' "$cargo_raw" | awk '/^[^ ]/ {sub(/ v.*/, ""); print}' | json_lines)"
  fi
fi
if [ -x "$legacy_uv" ]; then
  if uv_raw="$("$legacy_uv" tool list 2>/dev/null)"; then
    uv_globals="$(printf '%s\n' "$uv_raw" | awk '/^[^ -]/ {print $1}' | json_lines)"
  fi
fi


legacy_artifacts='[]'
for item in "$HOME/.local/share/fnm" "$HOME/.rustup" "$HOME/.bun/install/global" /opt/homebrew/Library/Taps.before-nix-homebrew /usr/local/Homebrew/Library/Taps.before-nix-homebrew; do
  if [ -e "$item" ]; then
    legacy_artifacts="$(printf '%s' "$legacy_artifacts" | jq --arg path "$item" '. + [{kind:"legacy-artifact",path:$path}]')"
  fi
done
for command_name in stow fnm rustup; do
  if command -v "$command_name" >/dev/null 2>&1; then
    command_path="$(command -v "$command_name")"
    legacy_artifacts="$(printf '%s' "$legacy_artifacts" | jq --arg path "$command_path" --arg command "$command_name" '. + [{kind:"legacy-command",path:$path,command:$command}]')"
  fi
done

configuration_artifacts='[]'
managed_directories=".agents .config/atuin .config/fish .config/ghostty .config/lazygit .config/nvim .config/sesh .config/tmux .config/yazi .pi/agent .pi/workflows"
if [ "$(uname -s)" = Darwin ]; then
  managed_directories="$managed_directories .config/aerospace .config/sketchybar"
fi
for relative in $managed_directories; do
  path="$HOME/$relative"
  if [ -L "$path" ]; then
    target="$(readlink "$path")"
    case "$target" in
      /nix/store/*) ;;
      *) configuration_artifacts="$(printf '%s' "$configuration_artifacts" | jq --arg path "$path" --arg target "$target" '. + [{kind:"non-store-directory-symlink",path:$path,target:$target}]')" ;;
    esac
  fi
done
while IFS= read -r backup; do
  configuration_artifacts="$(printf '%s' "$configuration_artifacts" | jq --arg path "$backup" '. + [{kind:"home-manager-backup",path:$path}]')"
done < <(find "$HOME/.config" "$HOME/.agents" "$HOME/.pi" -name '*.hm-backup*' -print 2>/dev/null || true)

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
  --argjson legacyArtifacts "$legacy_artifacts" \
  --argjson configurationArtifacts "$configuration_artifacts" \
  '
    ($desired.applications.homebrewCasks // [] | map(split("/")[-1]) | unique) as $declaredCasks
    | (["homebrew/core", "homebrew/cask"] + [
        $desired.applications.homebrewCasks[]?
        | split("/")
        | select(length >= 3)
        | .[0:2]
        | join("/")
      ] | unique) as $declaredTaps
    | ($desired.applications.mas // {} | to_entries | map({name:.key,id:.value})) as $declaredMas
    | ($declaredMas | map(.id)) as $declaredMasIds
    | ($mas | map(.id)) as $installedMasIds
    | {
        schemaVersion: 4,
        host: $host,
        generatedAt: $generatedAt,
        declared: {
          nixApplications: ($desired.applications.nix // []),
          homebrew: {casks:$declaredCasks,taps:$declaredTaps},
          masApplications: $declaredMas
        },
        external: {
          nixProfileEntries: $nixProfile,
          homebrew: {
            formulae: $formulae,
            casks: [$casks[]? | select(. as $item | $declaredCasks | index($item) | not)],
            taps: [$taps[]? | select(. as $item | $declaredTaps | index($item) | not)]
          },
          masApplications: [$mas[]? | select(.id as $id | $declaredMasIds | index($id) | not)],
          applicationBundles: [$applications[]? | select(.source == "manual")],
          globalPackages: {npm:$npm,bun:$bun,cargo:$cargo,uv:$uv},
          configurationArtifacts: ($legacyArtifacts + $configurationArtifacts | unique_by([.kind,.path]))
        },
        missing: {
          homebrewCasks: [$declaredCasks[] | select(. as $item | $casks | index($item) | not)],
          masApplications: [$declaredMas[] | select(.id as $id | $installedMasIds | index($id) | not)]
        }
      }
  ')"

if [ "$mode" = "--json" ]; then
  printf '%s\n' "$report"
else
  printf '%s\n' "$report" | jq -r '
    def section($label; $items):
      $label,
      (if ($items | length) == 0 then "  (none)" else ($items[] | "  \(.)") end);

    "Audit: \(.host) @ \(.generatedAt)",
    "",
    "Declared:",
    section("  Nix applications"; [.declared.nixApplications[]]),
    section("  Homebrew casks"; [.declared.homebrew.casks[]]),
    section("  MAS applications"; [.declared.masApplications[] | "\(.id):\(.name)"]),
    "",
    "Not managed by Nix:",
    section("  Nix profile entries"; [.external.nixProfileEntries | keys[]]),
    section("  Homebrew formulae"; [.external.homebrew.formulae[]]),
    section("  Homebrew casks"; [.external.homebrew.casks[]]),
    section("  Homebrew taps"; [.external.homebrew.taps[]]),
    section("  MAS applications"; [.external.masApplications[] | "\(.id):\(.name)"]),
    section("  Application bundles"; [.external.applicationBundles[] | "\(.path) [\(.bundleId // "")]" ]),
    section("  npm globals"; [.external.globalPackages.npm[]]),
    section("  Bun globals"; [.external.globalPackages.bun[]]),
    section("  Cargo globals"; [.external.globalPackages.cargo[]]),
    section("  uv tools"; [.external.globalPackages.uv[]]),
    section("  Configuration artifacts"; [.external.configurationArtifacts[] | "\(.kind): \(.path)\(if .target then " -> \(.target)" else "" end)"]),
    "",
    "Declared but missing:",
    section("  Homebrew casks"; [.missing.homebrewCasks[]]),
    section("  MAS applications"; [.missing.masApplications[] | "\(.id):\(.name)"])
  '
fi
