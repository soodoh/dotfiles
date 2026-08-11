{
  host,
  lib,
  pkgs,
  ...
}:
let
  cleanSource = import ../../lib/clean-source.nix { inherit lib; };
  profileSource = cleanSource ../../dotfiles/profiles/${host.profile};
in
{
  home.file = {
    ".agents" = {
      source = "${profileSource}/.agents";
      recursive = true;
    };
    ".pi/agent" = {
      source = "${profileSource}/.pi/agent";
      recursive = true;
    };
    ".pi/workflows" = {
      source = "${profileSource}/.pi/workflows";
      recursive = true;
    };
    ".pi/agent/pi-extensions" = {
      source = "${pkgs.dotfilesPackages.pi-extensions}/share/pi-extensions";
    };
  };
}
