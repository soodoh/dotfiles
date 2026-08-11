{
  host,
  lib,
  pkgs,
  ...
}:
{
  home.packages = [
    (pkgs.writeShellApplication {
      name = "nix-native-package-audit";
      runtimeInputs = [ pkgs.jq ];
      text =
        if host.name == "personal-arch" then
          ''
            set -eu
            packages="$(pacman -Qqe)"
            if [ "''${1:-}" = "--json" ]; then
              printf '%s\n' "$packages" | jq -Rsc '{platform:"arch",manager:"pacman",packages:(split("\\n") | map(select(length > 0)))}'
            else
              printf '%s\n' 'Native Arch packages (report only; Nix will not remove these):'
              printf '%s\n' "$packages"
            fi
          ''
        else
          ''
            set -eu
            packages="$(apt-mark showmanual)"
            if [ "''${1:-}" = "--json" ]; then
              printf '%s\n' "$packages" | jq -Rsc '{platform:"debian",manager:"apt",packages:(split("\\n") | map(select(length > 0)))}'
            else
              printf '%s\n' 'Native Debian packages (report only; Nix will not remove these):'
              printf '%s\n' "$packages"
            fi
          '';
    })
  ];

  warnings = lib.optional true "APT/Pacman, /etc, services, drivers, login-shell installation, and native package drift remain outside Home Manager.";
}
