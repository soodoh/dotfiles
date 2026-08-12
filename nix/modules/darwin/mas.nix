{
  host,
  lib,
  pkgs,
  ...
}:
let
  managedIds = lib.concatStringsSep " " (map toString (builtins.attrValues host.applications.mas));
  reconcileCommands = lib.concatStringsSep "\n" (
    lib.mapAttrsToList (name: id: ''
      if printf '%s\n' "$installed" | ${pkgs.gnugrep}/bin/grep -Eq "^[[:space:]]*${toString id}[[:space:]]"; then
        if printf '%s\n' "$outdated" | ${pkgs.gnugrep}/bin/grep -Eq "^[[:space:]]*${toString id}[[:space:]]"; then
          if ! run_mas upgrade ${toString id}; then
            echo >&2 "warning: MAS could not upgrade ${name} (${toString id})"
            mas_failed=1
          fi
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
    if installed="$(run_mas list ${managedIds} 2>/dev/null)"; then
      outdated=""
      if ! outdated="$(run_mas outdated --inaccurate ${managedIds} 2>/dev/null)"; then
        echo >&2 "warning: MAS could not check for application updates; missing applications will still be installed"
      fi
      ${reconcileCommands}
    else
      echo >&2 "warning: MAS could not inventory installed applications; reconciliation was skipped"
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
