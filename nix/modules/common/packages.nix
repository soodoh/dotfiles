{ pkgs, ... }:
{
  home.packages = [
    pkgs.gh
    pkgs.gnupg
    pkgs.go
    pkgs.jq
    pkgs.ripgrep
    pkgs.sesh
    pkgs.tmux
    pkgs.tree-sitter
    pkgs.wget
    pkgs.yazi
    pkgs.dotfilesPackages.pi
  ];

  programs = {
    atuin = {
      enable = true;
      enableFishIntegration = false;
    };
    fzf = {
      enable = true;
      enableFishIntegration = false;
    };
    lazygit.enable = true;
    starship = {
      enable = true;
      enableFishIntegration = false;
    };
    zoxide = {
      enable = true;
      enableFishIntegration = false;
    };
  };
}
