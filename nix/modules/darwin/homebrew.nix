{
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

  system.activationScripts.preActivation.text = lib.mkBefore (
    lib.optionalString stageScrollReverser ''
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
    ''
  );

}
