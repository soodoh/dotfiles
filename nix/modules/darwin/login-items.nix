{
  host,
  lib,
  pkgs,
  ...
}:
let
  loginItems = lib.mapAttrsToList (name: path: { inherit name path; }) (
    host.applications.loginItems or { }
  );
  loginItemRecords = lib.concatMapStringsSep ", " (
    item: "{${builtins.toJSON item.name}, ${builtins.toJSON item.path}}"
  ) loginItems;
  reconcileLoginItems = pkgs.writeText "reconcile-login-items.applescript" ''
    on run
      set hadError to false
      set desiredItems to {${loginItemRecords}}

      tell application "System Events"
        repeat with desiredItem in desiredItems
          set itemName to item 1 of desiredItem
          set itemPath to item 2 of desiredItem
          try
            if exists login item itemName then delete login item itemName
            make login item at end with properties {name:itemName, path:itemPath, hidden:false}
          on error errorMessage
            log "failed to reconcile login item " & itemName & ": " & errorMessage
            set hadError to true
          end try
        end repeat
      end tell

      if hadError then error "one or more login items could not be reconciled"
    end run
  '';
in
{
  system.activationScripts.postActivation.text = lib.mkAfter ''
    echo >&2 "Reconciling declarative macOS login items..."
    login_uid="$(/usr/bin/id -u ${lib.escapeShellArg host.username})"
    if /bin/launchctl print "gui/$login_uid" >/dev/null 2>&1; then
      if ! /bin/launchctl asuser "$login_uid" \
        /usr/bin/sudo --user=${lib.escapeShellArg host.username} --set-home \
        /usr/bin/osascript ${reconcileLoginItems}; then
        echo >&2 "warning: macOS login items could not be reconciled; rerun the switch from the logged-in desktop session"
      fi
    else
      echo >&2 "warning: ${host.username} has no active GUI session; login-item reconciliation was skipped"
    fi
  '';
}
