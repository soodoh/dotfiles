{ pkgs, ... }:
{
  home.packages = [
    pkgs.azure-cli
    pkgs.snowflake-cli
    pkgs.dotfilesPackages.twg
  ];
}
