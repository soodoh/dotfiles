{
  host,
  lib,
  pkgs,
  ...
}:
{
  environment.systemPackages = [
    pkgs.lima
    pkgs.docker
    pkgs.docker-compose
  ];

  home-manager.users.${host.username} = {
    services.colima = {
      enable = true;
      profiles.default = {
        isActive = true;
        isService = true;
        settings = {
          cpu = 4;
          memory = 8;
          disk = 100;
          arch = "aarch64";
          runtime = "docker";
          vmType = "vz";
          rosetta = true;
          mountType = "virtiofs";
          mountInotify = true;
        };
      };
    };

    # Home Manager normally restarts Colima after a successful foreground exit.
    # Preserve an explicit `colima stop` until the next login.
    launchd.agents.colima-default.config.KeepAlive.SuccessfulExit = lib.mkForce false;
  };
}
