{ pkgs, ... }:
{
  home.packages = [
    pkgs.awscli2
    pkgs.playwright-mcp
  ];
}
