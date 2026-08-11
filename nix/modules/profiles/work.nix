{ pkgs, ... }:
{
  home.packages = [
    pkgs.azure-cli
    pkgs.dotfilesPackages.twg
  ];
}
