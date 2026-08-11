{ host, pkgs, ... }:
let
  windowManagementPath = "/etc/profiles/per-user/${host.username}/bin:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  sketchybarAfterAeroSpace = pkgs.writeShellScript "sketchybar-after-aerospace" ''
    until ${pkgs.aerospace}/bin/aerospace list-workspaces --all >/dev/null 2>&1; do
      /bin/sleep 1
    done
    exec ${pkgs.sketchybar}/bin/sketchybar
  '';
in
{
  launchd.user.agents.sketchybar = {
    serviceConfig = {
      ProgramArguments = [ "${sketchybarAfterAeroSpace}" ];
      EnvironmentVariables.PATH = windowManagementPath;
      RunAtLoad = true;
      KeepAlive = true;
      ProcessType = "Interactive";
      StandardOutPath = "${host.homeDirectory}/Library/Logs/sketchybar.log";
      StandardErrorPath = "${host.homeDirectory}/Library/Logs/sketchybar.error.log";
    };
  };

  launchd.user.agents.jankyborders = {
    serviceConfig = {
      ProgramArguments = [
        "${pkgs.jankyborders}/bin/borders"
        "active_color=0xff7aa2f7"
        "inactive_color=0xff3b4261"
        "width=5.0"
      ];
      EnvironmentVariables.PATH = windowManagementPath;
      RunAtLoad = true;
      KeepAlive = true;
      ProcessType = "Interactive";
    };
  };
}
