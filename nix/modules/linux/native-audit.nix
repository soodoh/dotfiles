{
  host,
  lib,
  pkgs,
  ...
}:
let
  desiredLoginShell = "/usr/bin/fish";
  loginShellAudit = ''
    set -eu
    desired_shell=${lib.escapeShellArg desiredLoginShell}
    passwd_entry="$(getent passwd ${lib.escapeShellArg host.username} || true)"
    current_shell="''${passwd_entry##*:}"
    shell_installed=false
    shell_registered=false
    shell_configured=false
    if [ -x "$desired_shell" ]; then shell_installed=true; fi
    if grep -Fxq "$desired_shell" /etc/shells 2>/dev/null; then shell_registered=true; fi
    if [ "$current_shell" = "$desired_shell" ]; then shell_configured=true; fi
    login_shell="$(jq -n \
      --arg desired "$desired_shell" \
      --arg current "$current_shell" \
      --argjson installed "$shell_installed" \
      --argjson registered "$shell_registered" \
      --argjson configured "$shell_configured" \
      '{desired:$desired,current:($current | if length > 0 then . else null end),installed:$installed,registered:$registered,configured:$configured,healthy:($installed and $registered and $configured)}')"
  '';
in
{
  home.packages = [
    (pkgs.writeShellApplication {
      name = "nix-native-package-audit";
      runtimeInputs = [
        pkgs.getent
        pkgs.gnugrep
        pkgs.jq
      ];
      text =
        loginShellAudit
        + (
          if host.name == "personal-arch" then
            ''
              packages="$(pacman -Qqe)"
              if [ "''${1:-}" = "--json" ]; then
                printf '%s\n' "$packages" | jq -Rsc --argjson loginShell "$login_shell" '{platform:"arch",manager:"pacman",packages:(split("\\n") | map(select(length > 0))),loginShell:$loginShell}'
              else
                printf '%s\n' 'Native Arch packages (report only; Nix will not remove these):'
                printf '%s\n' "$packages"
                printf '%s\n' "$login_shell" | jq -r '"Login shell: \(.current // "unavailable") (expected \(.desired); installed=\(.installed), registered=\(.registered), configured=\(.configured))"'
              fi
            ''
          else
            ''
              packages="$(apt-mark showmanual)"
              if [ "''${1:-}" = "--json" ]; then
                printf '%s\n' "$packages" | jq -Rsc --argjson loginShell "$login_shell" '{platform:"debian",manager:"apt",packages:(split("\\n") | map(select(length > 0))),loginShell:$loginShell}'
              else
                printf '%s\n' 'Native Debian packages (report only; Nix will not remove these):'
                printf '%s\n' "$packages"
                printf '%s\n' "$login_shell" | jq -r '"Login shell: \(.current // "unavailable") (expected \(.desired); installed=\(.installed), registered=\(.registered), configured=\(.configured))"'
              fi
            ''
        );
    })
  ];

}
