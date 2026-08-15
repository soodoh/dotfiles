{ pkgs, ... }:
{
  # The vendor cask keeps `snow` inside its app bundle instead of Homebrew's bin directory.
  home.sessionPath = [ "/Applications/SnowflakeCLI.app/Contents/MacOS" ];
  home.packages = [
    pkgs.azure-cli
    pkgs.azure-mcp
    pkgs.google-cloud-sdk
    pkgs.playwright-mcp
    pkgs.dotfilesPackages.twg
    pkgs.dotfilesPackages.mcp-servers-work
    (pkgs.lib.hiPrio pkgs.corepack)
  ];
}
