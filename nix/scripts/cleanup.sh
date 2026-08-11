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
if [ "$profile" = personal ]; then
  replacement_commands="$replacement_commands readseek"
elif [ "$profile" = work ]; then
  replacement_commands="$replacement_commands twg"
fi
for command_name in $replacement_commands; do
  path="$(command -v "$command_name" 2>/dev/null || true)"
  resolved_path="$(realpath "$path" 2>/dev/null || true)"
  if [ -z "$resolved_path" ] || [[ "$resolved_path" != /nix/store/* ]]; then smoke_ok=false; fi
done

approved_casks="$(printf '%s' "$audit_json" | jq '.desired.applications.homebrewCasks // []')"
approved_mas="$(printf '%s' "$audit_json" | jq '[.desired.applications.mas // {} | .[]]')"
approved_bundles="$(printf '%s' "$audit_json" | jq '.desired.applications.approvedBundleIds // []')"
protected_mas_casks="$(printf '%s' "$audit_json" | jq '
  (.desired.applications.mas // {}) as $desired
  | [.observed.mas[]?.id] as $installed
  | [(.desired.applications.masFallbackCasks // {}) | to_entries[]
      | select(.key as $name | $desired[$name] as $id | ($installed | index($id) | not))
      | .value]
')"
formulae="$(printf '%s' "$audit_json" | jq '.observed.homebrew.formulae // []')"
casks="$(printf '%s' "$audit_json" | jq --argjson approved "$approved_casks" --argjson protected "$protected_mas_casks" '[.observed.homebrew.casks[]? | select(. as $item | ($approved + $protected) | index($item) | not)]')"
taps="$(printf '%s' "$audit_json" | jq '[.observed.homebrew.taps[]? | select(. != "homebrew/core" and . != "homebrew/cask")]')"
mas="$(printf '%s' "$audit_json" | jq --argjson approved "$approved_mas" '[.observed.mas[]? | select(.id as $id | $approved | index($id) | not)]')"
apps="$(printf '%s' "$audit_json" | jq --argjson approved "$approved_bundles" '[.observed.applications[]? | select(.source == "manual") | select((.bundleId | startswith("com.apple.")) | not) | select(.bundleId as $id | $approved | index($id) | not)]')"
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
  for item in "$HOME/.local/share/fnm" "$HOME/.rustup" "$HOME/.bun/install/global"; do
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
  printf '%s' "$casks" | jq -r '.[]' | while IFS= read -r item; do [ -n "$item" ] && "$brew_bin" uninstall --force --cask "$item"; done
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

legacy_npm="$HOME/.local/share/fnm/aliases/default/bin/npm"
legacy_node="$(dirname "$legacy_npm")/node"
legacy_bun="$HOME/.bun/bin/bun"
legacy_cargo="$HOME/.cargo/bin/cargo"
legacy_uv="$HOME/.local/bin/uv"
[ -x "$legacy_npm" ] && [ -x "$legacy_node" ] && printf '%s' "$globals" | jq -r '.npm[]' | while read -r item; do "$legacy_node" "$legacy_npm" uninstall -g "$item"; done || true
[ -x "$legacy_bun" ] && printf '%s' "$globals" | jq -r '.bun[]' | while read -r item; do BUN_INSTALL="$HOME/.bun" "$legacy_bun" remove -g "$item"; done || true
[ -x "$legacy_cargo" ] && printf '%s' "$globals" | jq -r '.cargo[]' | while read -r item; do "$legacy_cargo" uninstall "$item"; done || true
[ -x "$legacy_uv" ] && printf '%s' "$globals" | jq -r '.uv[]' | while read -r item; do "$legacy_uv" tool uninstall "$item"; done || true
printf '%s' "$legacy_dirs" | jq -r '.[]' | while IFS= read -r item; do
  [ -e "$item" ] && mv "$item" "$HOME/.Trash/$(basename "$item").$(date +%Y%m%d%H%M%S)"
done

echo "Cleanup completed. Regenerate the audit before any further cleanup."
