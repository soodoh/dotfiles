{
  host,
  lib,
  pkgs,
  ...
}:
let
  scripts = import ../../scripts { inherit pkgs; };
in
{
  home.packages = [ scripts.audit ];
  assertions = [
    {
      assertion = lib.hasPrefix "/home/" host.homeDirectory;
      message = "Linux Home Manager hosts must declare an explicit /home path.";
    }
  ];

  home = {
    inherit (host) username homeDirectory;
    stateVersion = "25.11";
  };

  targets.genericLinux.enable = true;
  programs.home-manager.enable = true;
}
