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

  system.activationScripts.postActivation.text = ''
    echo >&2 "Container runtime is declarative but not auto-started. Before removing Docker Desktop, verify:"
    echo >&2 "  colima start"
    echo >&2 "  docker run --rm hello-world"
    echo >&2 "  docker compose version"
  '';
}
