{ host, lib, ... }:
let
  loginItems = host.applications.loginItems or { };
  resolvePath =
    path: if lib.hasPrefix "~/" path then host.homeDirectory + lib.removePrefix "~" path else path;
in
{
  home-manager.users.${host.username}.launchd.agents = lib.mapAttrs' (
    name: path:
    lib.nameValuePair "login-item-${name}" {
      enable = true;
      config = {
        ProgramArguments = [
          "/usr/bin/open"
          (resolvePath path)
        ];
        ProcessType = "Interactive";
        RunAtLoad = true;
      };
    }
  ) loginItems;
}
