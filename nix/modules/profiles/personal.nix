{ pkgs, ... }:
{
  home.packages = [ pkgs.dotfilesPackages.readseek ];
}
