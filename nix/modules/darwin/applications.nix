{
  host,
  lib,
  pkgs,
  ...
}:
let
  resolveApplicationPackage =
    name:
    lib.attrByPath (lib.splitString "." name)
      (throw "Required Nix application package '${name}' is unavailable on ${host.system}")
      pkgs;
in
{
  _module.args = { inherit resolveApplicationPackage; };
  # Root/remote activation cannot receive App Management approval for
  # /Applications/Nix Apps. Disable nix-darwin's protected-directory sync and
  # expose GUI packages through store-backed Home Manager links instead.
  disabledModules = [ "system/applications.nix" ];
  system.build.applications = pkgs.buildEnv {
    name = "system-applications";
    paths = [ ];
    pathsToLink = [ "/Applications" ];
  };
  system.activationScripts.applications.text = "";

  home-manager.users.${host.username} = {
    home.packages = map resolveApplicationPackage host.applications.nix;
    targets.darwin = {
      copyApps.enable = false;
      linkApps.enable = true;
    };
  };
}
