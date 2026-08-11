{
  host,
  lib,
  pkgs,
  ...
}:
let
  installCommands = lib.concatStringsSep "\n" (
    lib.mapAttrsToList (name: id: ''
      if printf '%s\n' "$installed" | ${pkgs.gnugrep}/bin/grep -Eq "^[[:space:]]*${toString id}[[:space:]]"; then
        if ! run_mas upgrade ${toString id}; then
          echo >&2 "warning: MAS could not upgrade ${name} (${toString id})"
          mas_failed=1
        fi
      elif ! run_mas install ${toString id}; then
        echo >&2 "warning: MAS could not install ${name} (${toString id})"
        mas_failed=1
      fi
    '') host.applications.mas
  );
in
{
  environment.systemPackages = [ pkgs.mas ];

  system.activationScripts.postActivation.text = lib.mkAfter ''
    echo >&2 "Reconciling Mac App Store applications with Nix-provided mas..."
    mas_failed=0
    run_mas() {
      /usr/bin/sudo --user=${host.username} --set-home ${pkgs.mas}/bin/mas "$@"
    }
    if installed="$(run_mas list 2>/dev/null)"; then
      ${installCommands}
    else
      echo >&2 "warning: Mac App Store account is unavailable; MAS reconciliation was skipped"
      mas_failed=1
    fi

    if [ "$mas_failed" -ne 0 ]; then
      echo >&2 "Manual MAS follow-up: open the App Store, sign in without storing credentials in Nix, then run:"
      ${lib.concatStringsSep "\n" (
        lib.mapAttrsToList (
          name: id: ''echo >&2 "  ${pkgs.mas}/bin/mas install ${toString id}  # ${name}"''
        ) host.applications.mas
      )}
    fi
    true
  '';
}
