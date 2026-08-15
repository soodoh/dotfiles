{ pkgs }:
let
  hosts = {
    personal-macos = import ../hosts/personal-macos;
    work-macos = import ../hosts/work-macos;
  };
  auditHosts = builtins.mapAttrs (_name: host: {
    inherit (host) name;
    applications = {
      nix = host.applications.nix or [ ];
      homebrewCasks = host.applications.homebrewCasks or [ ];
      mas = host.applications.mas or { };
    };
  }) hosts;
  hostsJson = pkgs.writeText "dotfiles-audit-hosts.json" (builtins.toJSON auditHosts);
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
in
{
  inherit audit hostsJson;
}
