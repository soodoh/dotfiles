{ pkgs, ... }:
{
  home.packages = [
    pkgs.bun
    pkgs.nodejs_24
    pkgs.python3
    pkgs.uv
    pkgs.fenix.stable.completeToolchain
  ];

  home.sessionVariables = {
    COREPACK_ENABLE_PROJECT_SPEC = "0";
    RUSTUP_TOOLCHAIN = "stable";
  };
}
