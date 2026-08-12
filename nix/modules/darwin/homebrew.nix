{
  config,
  host,
  inputs,
  lib,
  pkgs,
  ...
}:
let
  homebrewTaps = {
    "homebrew/homebrew-core" = inputs.homebrew-core;
    "homebrew/homebrew-cask" = inputs.homebrew-cask;
  }
  // lib.optionalAttrs (host.profile == "work") {
    "snowflakedb/homebrew-snowflake-cli" = inputs.homebrew-snowflake-cli;
  };

  scrollReverserVersion = pkgs.scroll-reverser.version;
  scrollReverserUrl = "https://pilotmoon.com/downloads/ScrollReverser-${scrollReverserVersion}.zip";
  scrollReverserCachePath =
    "${host.homeDirectory}/Library/Caches/Homebrew/downloads/"
    + "${builtins.hashString "sha256" scrollReverserUrl}--${builtins.baseNameOf scrollReverserUrl}";
  stageScrollReverser =
    host.profile == "work" && builtins.elem "scroll-reverser" host.applications.homebrewCasks;
in
{
  nix-homebrew = {
    enable = true;
    user = host.username;
    enableRosetta = true;
    autoMigrate = true;
    taps = homebrewTaps;
    mutableTaps = false;
    extraEnv.HOMEBREW_NO_INSTALL_FROM_API = "1";
    enableBashIntegration = false;
    enableFishIntegration = false;
    enableZshIntegration = false;
  };

  homebrew = {
    enable = true;
    user = host.username;
    brews = [ ];
    casks = host.applications.homebrewCasks;
    taps = builtins.attrNames homebrewTaps;
    onActivation = {
      autoUpdate = false;
      upgrade = true;
      cleanup = "none";
      extraEnv = {
        HOMEBREW_NO_ANALYTICS = "1";
        HOMEBREW_NO_ENV_HINTS = "1";
      };
    };
    global.autoUpdate = false;
  };

  # nix-homebrew cannot replace a mutable taps directory when switching to
  # immutable pinned taps. Preserve it for the confirmation-gated cleanup.
  system.activationScripts.preActivation.text = lib.mkBefore ''
    ${lib.optionalString stageScrollReverser ''
      # Zscaler blocks Homebrew's direct request to pilotmoon.com. Stage the
      # same hash-pinned upstream archive from nixpkgs in Homebrew's cache;
      # Homebrew still verifies and owns the installed cask application.
      /usr/bin/sudo --user=${lib.escapeShellArg host.username} --set-home \
        /usr/bin/install -d -m 0755 \
        ${lib.escapeShellArg (builtins.dirOf scrollReverserCachePath)}
      /usr/bin/sudo --user=${lib.escapeShellArg host.username} --set-home \
        /usr/bin/install -m 0644 \
        ${lib.escapeShellArg pkgs.scroll-reverser.src} \
        ${lib.escapeShellArg scrollReverserCachePath}
    ''}
    for taps_path in /opt/homebrew/Library/Taps /usr/local/Homebrew/Library/Taps; do
      if [ ! -e "$taps_path" ]; then
        continue
      fi
      if [ -L "$taps_path" ] && [[ "$(readlink "$taps_path")" == /nix/store/* ]]; then
        continue
      fi
      backup_path="$taps_path.before-nix-homebrew"
      if [ -e "$backup_path" ]; then
        echo >&2 "Cannot preserve mutable Homebrew taps: $backup_path already exists"
        exit 1
      fi
      echo >&2 "preserving mutable Homebrew taps at $backup_path..."
      mv "$taps_path" "$backup_path"
    done
  '';

  system.activationScripts.postActivation.text = ''
    echo >&2 "Homebrew fallback drift (report-only during switch):"
    brew_command="${config.homebrew.prefix}/bin/brew"
    if [ -x "$brew_command" ]; then
      brew_user() {
        /usr/bin/sudo --user=${host.username} --set-home "$brew_command" "$@"
      }
      unmanaged_formulae="$(brew_user leaves 2>/dev/null || true)"
      unmanaged_casks="$(brew_user list --cask 2>/dev/null || true)"
      if [ -n "$unmanaged_formulae" ]; then
        echo >&2 "  unmanaged/top-level formulae remain installed; run ./bin/nix-audit ${host.name}"
      fi
      if [ -n "$unmanaged_casks" ]; then
        echo >&2 "  installed casks were inventoried; ordinary activation will not remove extras"
      fi
    else
      echo >&2 "  brew unavailable; nix-homebrew will initialize it when possible"
    fi
  '';
}
