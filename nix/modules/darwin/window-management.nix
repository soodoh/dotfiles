{ host, pkgs, ... }:
{
  launchd.user.agents.sketchybar = {
    serviceConfig = {
      ProgramArguments = [ "${pkgs.sketchybar}/bin/sketchybar" ];
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
      RunAtLoad = true;
      KeepAlive = true;
      ProcessType = "Interactive";
    };
  };
}
