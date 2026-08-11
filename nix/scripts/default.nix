{ pkgs }:
let
  hosts = {
    personal-macos = import ../hosts/personal-macos;
    work-macos = import ../hosts/work-macos;
    personal-arch = import ../hosts/personal-arch;
    personal-debian = import ../hosts/personal-debian;
  };
  hostsJson = pkgs.writeText "dotfiles-hosts.json" (builtins.toJSON hosts);
  audit = pkgs.writeShellApplication {
    name = "nix-audit";
    runtimeInputs = with pkgs; [
      coreutils
      findutils
      gnugrep
      gnused
      jq
    ];
    text = ''
      export NIX_DOTFILES_HOSTS_JSON=${hostsJson}
      ${builtins.readFile ./audit.sh}
    '';
  };
  cleanup = pkgs.writeShellApplication {
    name = "nix-cleanup";
    runtimeInputs = with pkgs; [
      coreutils
      gnugrep
      jq
    ];
    text = ''
      export NIX_DOTFILES_AUDIT_BIN=${audit}/bin/nix-audit
      ${builtins.readFile ./cleanup.sh}
    '';
  };
in
{
  inherit audit cleanup hostsJson;
}
