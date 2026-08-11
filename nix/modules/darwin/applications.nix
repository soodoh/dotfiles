{
  host,
  lib,
  pkgs,
  ...
}:
let
  resolvePackage =
    name:
    lib.attrByPath (lib.splitString "." name)
      (throw "Required Nix application package '${name}' is unavailable on ${host.system}")
      pkgs;
in
{
  environment.systemPackages = map resolvePackage host.applications.nix;
}
