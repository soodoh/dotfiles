{ pkgs, ... }:
{
  home.packages = [
    pkgs.atuin
    pkgs.fzf
    pkgs.gh
    pkgs.git
    pkgs.gnupg
    pkgs.go
    pkgs.jq
    pkgs.lazygit
    pkgs.ripgrep
    pkgs.sesh
    pkgs.starship
    pkgs.tmux
    pkgs.tree-sitter
    pkgs.wget
    pkgs.yazi
    pkgs.zoxide
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
