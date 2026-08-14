{ pkgs, ... }:
{
  home.packages = [
    pkgs.bun
    pkgs.nodejs_24
    pkgs.python3
    pkgs.uv
    pkgs.cargo
    pkgs.clippy
    pkgs.rustc
    pkgs.rustfmt
  ];

  home.sessionVariables.RUST_SRC_PATH = pkgs.rustPlatform.rustLibSrc;
}
