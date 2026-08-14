{
  host,
  inputs,
  lib,
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
}
