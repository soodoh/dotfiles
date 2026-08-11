{ config, host, ... }:
{
  nix-homebrew = {
    enable = true;
    user = host.username;
    enableRosetta = true;
    autoMigrate = true;
    mutableTaps = true;
    enableBashIntegration = false;
    enableFishIntegration = false;
    enableZshIntegration = false;
  };

  homebrew = {
    enable = true;
    user = host.username;
    brews = [ ];
    casks = host.applications.homebrewCasks;
    taps = [ ];
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
