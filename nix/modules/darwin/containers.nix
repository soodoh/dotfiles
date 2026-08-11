{ host, pkgs, ... }:
let
  colimaConfig = pkgs.writeText "colima.yaml" ''
    cpu: 4
    memory: 8
    disk: 100
    arch: aarch64
    runtime: docker
    vmType: vz
    rosetta: true
    mountType: virtiofs
    mountInotify: true
  '';
in
{
  environment.systemPackages = [
    pkgs.colima
    pkgs.lima
    pkgs.docker
    pkgs.docker-compose
  ];

  # Colima rewrites this file during `start`, so activation materializes the
  # declarative store source as a user-writable runtime copy.
  home-manager.users.${host.username} =
    { lib, ... }:
    {
      home.activation.colimaConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        config_dir="$HOME/.colima/default"
        config_path="$config_dir/colima.yaml"
        config_tmp="$config_path.tmp"
        mkdir -p "$config_dir"
        install -m 600 ${colimaConfig} "$config_tmp"
        mv -f "$config_tmp" "$config_path"
      '';
    };

  # Keep Colima in the foreground so launchd owns its lifetime. Restart it only
  # after failures; a clean `colima stop` remains effective until the next login.
  launchd.user.agents.colima = {
    serviceConfig = {
      ProgramArguments = [
        "${pkgs.colima}/bin/colima"
        "start"
        "--foreground"
      ];
      RunAtLoad = true;
      KeepAlive.SuccessfulExit = false;
      ProcessType = "Interactive";
      WorkingDirectory = host.homeDirectory;
      EnvironmentVariables.HOME = host.homeDirectory;
      StandardOutPath = "${host.homeDirectory}/Library/Logs/colima.log";
      StandardErrorPath = "${host.homeDirectory}/Library/Logs/colima.error.log";
    };
  };
}
