{ host, pkgs, ... }:
{
  home-manager.users.${host.username} =
    { config, lib, ... }:
    let
      userProfileBin = "/etc/profiles/per-user/${host.username}/bin";
      aerospaceSettings = builtins.fromTOML (
        builtins.readFile ../../dotfiles/darwin/.config/aerospace/aerospace.toml
      );
      sketchybarAfterAeroSpace = pkgs.writeShellScript "sketchybar-after-aerospace" ''
        until ${pkgs.aerospace}/bin/aerospace list-workspaces --all >/dev/null 2>&1; do
          /bin/sleep 1
        done
        exec ${config.programs.sketchybar.finalPackage}/bin/sketchybar
      '';
    in
    {
      programs.aerospace = {
        enable = true;
        launchd.enable = true;
        settings = aerospaceSettings // {
          "exec-on-workspace-change" = [
            "/bin/bash"
            "-c"
            "${userProfileBin}/sketchybar --trigger aerospace_workspace_change FOCUSED_WORKSPACE=$AEROSPACE_FOCUSED_WORKSPACE PREV_WORKSPACE=$AEROSPACE_PREV_WORKSPACE"
          ];
        };
      };

      programs.sketchybar = {
        enable = true;
        config = {
          source = ../../dotfiles/darwin/.config/sketchybar;
          recursive = true;
        };
        extraPackages = [
          pkgs.aerospace
          pkgs.bun
          pkgs.jq
        ];
      };

      launchd.agents.sketchybar.config.Program = lib.mkForce "${sketchybarAfterAeroSpace}";

      services.jankyborders = {
        enable = true;
        outLogFile = "${host.homeDirectory}/Library/Logs/jankyborders.log";
        errorLogFile = "${host.homeDirectory}/Library/Logs/jankyborders.error.log";
        settings = {
          active_color = "0xff7aa2f7";
          inactive_color = "0xff3b4261";
          width = 5.0;
        };
      };
    };
}
