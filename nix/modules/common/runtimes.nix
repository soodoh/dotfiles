{ pkgs, ... }:
{
  home.packages = [
    pkgs.bun
    pkgs.nodejs_24
    pkgs.python3
    pkgs.uv
    (pkgs.fenix.stable.withComponents [
      "cargo"
      "clippy"
      "rust-src"
      "rustc"
      "rustfmt"
    ])
  ];

  home.sessionVariables = {
    COREPACK_ENABLE_PROJECT_SPEC = "0";
  };
}
