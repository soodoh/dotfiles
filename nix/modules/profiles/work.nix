{ pkgs, ... }:
{
  # The vendor cask keeps `snow` inside its app bundle instead of Homebrew's bin directory.
  home.sessionPath = [ "/Applications/SnowflakeCLI.app/Contents/MacOS" ];
  home.packages = [
    pkgs.azure-cli
    pkgs.dotfilesPackages.twg
  ];
}
