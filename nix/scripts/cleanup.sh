set -euo pipefail
host="${1:-}"
if [ -z "$host" ]; then
  echo >&2 "usage: nix-cleanup <host>"
  exit 2
fi

if [ -n "${NIX_DOTFILES_AUDIT_FIXTURE:-}" ]; then
  audit_json="$(cat "$NIX_DOTFILES_AUDIT_FIXTURE")"
else
  audit_json="$("$NIX_DOTFILES_AUDIT_BIN" "$host" --json)"
fi

smoke_ok=true
replacement_commands="pi bun node corepack rustc cargo uv"
profile="$(printf '%s' "$audit_json" | jq -r '.desired.profile')"
if [ "$profile" = work ]; then
  replacement_commands="$replacement_commands twg"
fi
for command_name in $replacement_commands; do
  path="$(command -v "$command_name" 2>/dev/null || true)"
  resolved_path="$(realpath "$path" 2>/dev/null || true)"
  if [ -z "$resolved_path" ] || [[ "$resolved_path" != /nix/store/* ]]; then smoke_ok=false; fi
done

approved_casks="$(printf '%s' "$audit_json" | jq '[.desired.applications.homebrewCasks[]? | split("/")[-1]]')"
protected_unmanaged_casks="$(printf '%s' "$audit_json" | jq '[.desired.applications.cleanupProtected.homebrewCasks[]? | split("/")[-1]]')"
protected_taps="$(printf '%s' "$audit_json" | jq '.desired.applications.cleanupProtected.homebrewTaps // []')"
approved_mas="$(printf '%s' "$audit_json" | jq '[.desired.applications.mas // {} | .[]]')"
approved_bundles="$(printf '%s' "$audit_json" | jq '[(.desired.applications.approvedBundleIds // [])[], (.desired.applications.cleanupProtected.bundleIds // [])[]] | unique')"
protected_mas_casks="$(printf '%s' "$audit_json" | jq '
  (.desired.applications.mas // {}) as $desired
  | [.observed.mas[]?.id] as $installed
  | [(.desired.applications.masFallbackCasks // {}) | to_entries[]
      | select(.key as $name | $desired[$name] as $id | ($installed | index($id) | not))
      | .value]
')"
formulae="$(printf '%s' "$audit_json" | jq '[.observed.homebrew.formulae[]? | split("/")[-1]] | unique')"
casks="$(printf '%s' "$audit_json" | jq --argjson approved "$approved_casks" --argjson unmanaged "$protected_unmanaged_casks" --argjson mas "$protected_mas_casks" '[.observed.homebrew.casks[]? | select(. as $item | ($approved + $unmanaged + $mas) | index($item) | not)]')"
taps="$(printf '%s' "$audit_json" | jq --argjson protected "$protected_taps" '[.observed.homebrew.taps[]? | select(. != "homebrew/core") | select(. as $item | $protected | index($item) | not)]')"
mas="$(printf '%s' "$audit_json" | jq --argjson approved "$approved_mas" '[.observed.mas[]? | select(.id as $id | $approved | index($id) | not)]')"
unidentified_apps="$(printf '%s' "$audit_json" | jq '[.observed.applications[]? | select(.source == "manual" and .bundleId == "")]')"
apps="$(printf '%s' "$audit_json" | jq --argjson approved "$approved_bundles" '[.observed.applications[]? | select(.source == "manual" and .bundleId != "") | select(.bundleId as $id | $approved | index($id) | not)]')"
if [ "$(printf '%s' "$unidentified_apps" | jq length)" -gt 0 ]; then
  echo >&2 "Application bundles without identifiers are protected: $(printf '%s' "$unidentified_apps" | jq -r 'map(.path) | join(", ")')"
fi
if [ "$(printf '%s' "$protected_mas_casks" | jq length)" -gt 0 ]; then
  echo >&2 "MAS fallback casks are protected until desired MAS apps are installed: $(printf '%s' "$protected_mas_casks" | jq -r 'join(", ")')"
fi

if printf '%s' "$casks" | jq -e 'index("docker-desktop") != null or index("docker") != null' >/dev/null \
  || printf '%s' "$apps" | jq -e '.[]? | select(.bundleId == "com.docker.docker")' >/dev/null; then
  if ! command -v colima >/dev/null 2>&1 || ! colima status >/dev/null 2>&1 || ! docker run --rm hello-world >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    echo >&2 "Docker Desktop is protected: Colima/hello-world/Compose verification did not all pass."
    casks="$(printf '%s' "$casks" | jq '[.[] | select(. != "docker-desktop" and . != "docker")]')"
    apps="$(printf '%s' "$apps" | jq '[.[] | select(.bundleId != "com.docker.docker")]')"
  fi
fi

globals='{"npm":[],"bun":[],"cargo":[],"uv":[]}'
legacy_dirs='[]'
if $smoke_ok; then
  globals="$(printf '%s' "$audit_json" | jq '.observed.legacyGlobals // {npm:[],bun:[],cargo:[],uv:[]}')"
  for item in "$HOME/.local/share/fnm" "$HOME/.rustup" "$HOME/.bun/install/global" /opt/homebrew/Library/Taps.before-nix-homebrew /usr/local/Homebrew/Library/Taps.before-nix-homebrew; do
    if [ -e "$item" ]; then legacy_dirs="$(printf '%s' "$legacy_dirs" | jq --arg item "$item" '. + [$item]')"; fi
  done
else
  echo >&2 "Legacy global package managers are protected: Nix replacement smoke/path checks did not pass."
fi

plan="$(jq -n --arg host "$host" --argjson formulae "$formulae" --argjson casks "$casks" --argjson taps "$taps" --argjson mas "$mas" --argjson apps "$apps" --argjson globals "$globals" --argjson legacyDirs "$legacy_dirs" '{host:$host,homebrew:{formulae:$formulae,casks:$casks,taps:$taps},mas:$mas,applications:$apps,legacyGlobals:$globals,legacyDirectories:$legacyDirs,nativePackages:"report-only"}')"
printf '%s\n' "$plan" | jq -r '"Fresh cleanup plan for \(.host):\n  Homebrew formulae: \(.homebrew.formulae|join(", "))\n  Homebrew casks: \(.homebrew.casks|join(", "))\n  Homebrew taps: \(.homebrew.taps|join(", "))\n  MAS apps: \(.mas|map("\(.id):\(.name)")|join(", "))\n  Application bundles: \(.applications|map(.path)|join(", "))\n  npm globals: \(.legacyGlobals.npm|join(", "))\n  Bun globals: \(.legacyGlobals.bun|join(", "))\n  Cargo globals: \(.legacyGlobals.cargo|join(", "))\n  uv tools: \(.legacyGlobals.uv|join(", "))\n  Legacy directories: \(.legacyDirectories|join(", "))\n  APT/Pacman: report-only (never removed)"'

printf 'Type CLEAN to execute exactly this plan: '
IFS= read -r confirmation || confirmation=""
if [ "$confirmation" != CLEAN ]; then
  echo "Cleanup cancelled; nothing was removed."
  exit 3
fi
mkdir -p "$HOME/.Trash"

remove_legacy_cask() {
  local cask_name="$1"
  local caskroom="$2/$cask_name"
  local receipt="$caskroom/.metadata/INSTALL_RECEIPT.json"
  local config="$caskroom/.metadata/config.json"
  if [ ! -f "$receipt" ] || ! jq -e '[.uninstall_artifacts[]? | keys[] | select(. != "app")] | length == 0' "$receipt" >/dev/null; then
    echo >&2 "Cannot safely remove unavailable cask $cask_name: unsupported or missing receipt"
    return 1
  fi

  local appdir="/Applications"
  if [ -f "$config" ]; then
    appdir="$(jq -r '.default.appdir // "/Applications"' "$config")"
  fi
  while IFS= read -r app_name; do
    [ -z "$app_name" ] && continue
    local app_path="$appdir/$app_name"
    [ -e "$app_path" ] || continue
    local app_destination
    app_destination="$HOME/.Trash/$(basename "$app_path").$(date +%Y%m%d%H%M%S)"
    if ! mv "$app_path" "$app_destination" 2>/dev/null; then
      /usr/bin/sudo mv "$app_path" "$app_destination"
    fi
  done < <(jq -r '.uninstall_artifacts[]?.app[]?' "$receipt")

  if [ -e "$caskroom" ]; then
    mv "$caskroom" "$HOME/.Trash/homebrew-cask-$cask_name.$(date +%Y%m%d%H%M%S)"
  fi
  echo "Removed unavailable legacy cask $cask_name using its install receipt."
}

brew_bin="$(command -v brew 2>/dev/null || true)"
for candidate in "$brew_bin" /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -x "$candidate" ]; then brew_bin="$candidate"; break; fi
done
if [ -n "$brew_bin" ] && [ -x "$brew_bin" ]; then
  printf '%s' "$formulae" | jq -r '.[]' | while IFS= read -r item; do
    [ -z "$item" ] && continue
    formula_name="${item##*/}"
    service_label="homebrew.mxcl.$formula_name"
    if [ "$(uname -s)" = Darwin ]; then
      /bin/launchctl bootout "gui/$(id -u)/$service_label" >/dev/null 2>&1 || true
      rm -f "$HOME/Library/LaunchAgents/$service_label.plist"
    fi
    "$brew_bin" services stop "$formula_name" >/dev/null 2>&1 || true
    "$brew_bin" uninstall --force --ignore-dependencies --formula "$formula_name"
  done
  caskroom="$($brew_bin --caskroom)"
  printf '%s' "$casks" | jq -r '.[]' | while IFS= read -r item; do
    [ -z "$item" ] && continue
    if ! "$brew_bin" uninstall --force --cask "$item"; then
      remove_legacy_cask "$item" "$caskroom"
    fi
  done
  "$brew_bin" autoremove
  printf '%s' "$taps" | jq -r '.[]' | while IFS= read -r item; do [ -n "$item" ] && "$brew_bin" untap --force "$item"; done
fi
if command -v mas >/dev/null 2>&1; then
  printf '%s' "$mas" | jq -r '.[].id' | while IFS= read -r id; do [ -n "$id" ] && mas uninstall "$id"; done
fi
printf '%s' "$apps" | jq -c '.[]' | while IFS= read -r app; do
  path="$(printf '%s' "$app" | jq -r .path)"
  [ -e "$path" ] || continue
  bundle="$(printf '%s' "$app" | jq -r .bundleId)"
  [ -n "$bundle" ] && osascript -e "tell application id \"$bundle\" to quit" >/dev/null 2>&1 || true
  destination="$HOME/.Trash/$(basename "$path").$(date +%Y%m%d%H%M%S)"
  if ! mv "$path" "$destination" 2>/dev/null; then
    /usr/bin/sudo mv "$path" "$destination"
  fi
done

legacy_cargo="$HOME/.cargo/bin/cargo"
legacy_uv="$HOME/.local/bin/uv"
if [ -x "$legacy_cargo" ]; then
  printf '%s' "$globals" | jq -r '.cargo[]' | while IFS= read -r item; do
    if ! "$legacy_cargo" uninstall "$item"; then
      echo >&2 "Warning: failed to uninstall legacy Cargo package $item"
    fi
  done
fi
if [ -x "$legacy_uv" ]; then
  printf '%s' "$globals" | jq -r '.uv[]' | while IFS= read -r item; do
    if ! "$legacy_uv" tool uninstall "$item"; then
      echo >&2 "Warning: failed to uninstall legacy uv tool $item"
    fi
  done
fi

# The npm and Bun globals live entirely inside directories already included in
# the reviewed plan, so moving those trees is safer than running old managers.
quarantine_root="$HOME/.local/state/dotfiles-nix/cleanup-quarantine/$(date +%Y%m%d%H%M%S)"
printf '%s' "$legacy_dirs" | jq -r '.[]' | while IFS= read -r item; do
  [ -e "$item" ] || continue
  destination="$HOME/.Trash/$(basename "$item").$(date +%Y%m%d%H%M%S)"
  if mv "$item" "$destination" 2>/dev/null; then
    continue
  fi

  mkdir -p "$quarantine_root"
  destination="$quarantine_root/$(basename "$item")"
  echo >&2 "Trash access unavailable; quarantining $item at $destination"
  if ! mv "$item" "$destination" 2>/dev/null; then
    /usr/bin/sudo mv "$item" "$destination"
  fi
done

echo "Cleanup completed. Regenerate the audit before any further cleanup."
