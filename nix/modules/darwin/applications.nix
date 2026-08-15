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
  # GUI packages stay in Home Manager, leaving nix-darwin's system application
  # set empty while retaining its upstream activation behavior.

  home-manager.users.${host.username} = {
    home.packages = map resolveApplicationPackage host.applications.nix;
    targets.darwin = {
      copyApps.enable = false;
      linkApps.enable = true;
    };
  };
}
