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
  cominPlist = config.environment.launchDaemons."com.github.nlewo.comin.plist".source;

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
    supervisor_pid="$$"

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
    /usr/bin/touch "/var/lib/comin/supervisor-$supervisor_pid"
    trap '/bin/rm -f "/var/lib/comin/supervisor-$supervisor_pid"' EXIT
    ${lib.getExe cfg.package} run --config ${cominConfig.cominConfigYaml} &
    child_pid=$!
    wait "$child_pid"
    status=$?
    /bin/rm -f "/var/lib/comin/supervisor-$supervisor_pid"
    exit "$status"
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

  # A changed plist would make nix-darwin unload the daemon performing the
  # activation. Fail unattended deployment before launchd reconciliation;
  # plist changes must be installed by an explicit manual switch.
  system.activationScripts.checks.text = lib.mkAfter ''
    unattended=false
    while IFS= read -r marker; do
      supervisor_pid="''${marker##*-}"
      if [[ "$supervisor_pid" =~ ^[0-9]+$ ]] \
        && /bin/kill -0 "$supervisor_pid" 2>/dev/null \
        && /bin/ps -p "$supervisor_pid" -o command= \
          | /usr/bin/grep -q '/comin-supervisor$' \
        && /usr/bin/pgrep -P "$supervisor_pid" -x comin >/dev/null; then
        unattended=true
        break
      fi
      /bin/rm -f "$marker"
    done < <(/usr/bin/find /var/lib/comin -maxdepth 1 -name 'supervisor-*' -type f -print 2>/dev/null)

    if "$unattended" \
      && ! /usr/bin/cmp -s '${cominPlist}' /Library/LaunchDaemons/com.github.nlewo.comin.plist; then
      echo >&2 "Comin's launchd definition changed; apply this generation with a manual nix-darwin switch"
      exit 1
    fi
  '';

  # Keep routine launchd definitions generation-independent. The activation
  # guard above turns any future plist change into a manual migration.
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
