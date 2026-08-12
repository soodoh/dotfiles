{
  config,
  host,
  inputs,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.comin;
  cominConfig = import "${inputs.comin}/nix/comin-config.nix" {
    inherit config pkgs lib;
  };
  githubWebFlowKey = ../../keys/github-web-flow.gpg;

  restartSupervisor = pkgs.writeShellScript "restart-comin-supervisor" ''
    if [ "''${COMIN_STATUS:-}" != "done" ]; then
      exit 0
    fi

    case "''${COMIN_SUPERVISOR_PID:-}" in
      "" | *[!0-9]*) exit 1 ;;
    esac

    /bin/kill -HUP "$COMIN_SUPERVISOR_PID"
  '';

  cominSupervisor = pkgs.writeShellScriptBin "comin-supervisor" ''
    set -u

    child_pid=""

    restart() {
      trap - HUP
      if [ -n "$child_pid" ]; then
        /bin/kill -TERM "$child_pid" 2>/dev/null || true
        wait "$child_pid" 2>/dev/null || true
      fi
      exec /run/current-system/sw/bin/comin-supervisor
    }

    shutdown() {
      trap - HUP TERM INT
      if [ -n "$child_pid" ]; then
        /bin/kill -TERM "$child_pid" 2>/dev/null || true
        wait "$child_pid" 2>/dev/null || true
      fi
      exit 0
    }

    trap restart HUP
    trap shutdown TERM INT

    export COMIN_SUPERVISOR_PID="$$"
    ${lib.getExe cfg.package} run --config ${cominConfig.cominConfigYaml} &
    child_pid=$!
    wait "$child_pid"
  '';
in
{
  services.comin = {
    enable = true;
    hostname = host.name;
    buildTimeout = 7200;
    gpgPublicKeyPaths = [ (toString githubWebFlowKey) ];
    postDeploymentCommand = restartSupervisor;
    remotes = [
      {
        name = "origin";
        url = "https://github.com/soodoh/dotfiles.git";
        branches = {
          main = {
            name = "main";
            operation = "switch";
          };
          testing.name = "";
        };
        poller.period = 300;
      }
    ];
  };

  environment.systemPackages = [ cominSupervisor ];

  # Keep launchd's definition generation-independent. The stable supervisor
  # re-execs its new generation only after deployment state has been persisted.
  launchd.daemons.comin = {
    command = lib.mkForce "/run/current-system/sw/bin/comin-supervisor";
    serviceConfig.EnvironmentVariables.PATH = lib.mkForce (
      lib.concatStringsSep ":" [
        "/run/current-system/sw/bin"
        "/nix/var/nix/profiles/default/bin"
        "/usr/bin"
        "/bin"
        "/usr/sbin"
        "/sbin"
      ]
    );
  };
}
