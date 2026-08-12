{
  config,
  host,
  lib,
  pkgs,
  ...
}:
{
  services.comin = {
    enable = true;
    hostname = host.name;
    buildTimeout = 7200;
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

  # Comin updates its on-disk plist during activation but cannot reload itself
  # until after deployment state is persisted. Submit a detached launchd job
  # that waits for Comin's clean exit, then reloads the staged definition.
  services.comin.postDeploymentCommand =
    let
      reloadWorker = pkgs.writeShellScript "reload-staged-comin" ''
        previous_pid="$1"
        while /bin/kill -0 "$previous_pid" >/dev/null 2>&1; do
          /bin/sleep 1
        done
        /bin/launchctl bootout system/com.github.nlewo.comin 2>/dev/null || true
        /bin/launchctl bootstrap system /Library/LaunchDaemons/com.github.nlewo.comin.plist
      '';
    in
    pkgs.writeShellScript "reload-comin-after-deployment" ''
      if [ "''${COMIN_STATUS:-}" != "done" ]; then
        exit 0
      fi

      /bin/launchctl submit \
        -l com.github.nlewo.comin.reloader \
        -o /var/log/comin-reloader.log \
        -e /var/log/comin-reloader.log \
        -- ${reloadWorker} "$PPID"
    '';

  # Comin is the process running activation. Reconcile every other launchd
  # service normally, but only stage Comin's plist. Comin compares the loaded
  # job before and after activation, records success, and exits so launchd can
  # restart it from the staged plist.
  system.activationScripts.launchd.text =
    let
      launchdActivation = basedir: target: ''
        if ! diff '${config.system.build.launchd}/Library/${basedir}/${target}' '/Library/${basedir}/${target}' &> /dev/null; then
          if test -f '/Library/${basedir}/${target}'; then
            echo "reloading service $(basename ${target} .plist)" >&2
            ${lib.optionalString (
              target != "com.github.nlewo.comin.plist"
            ) "launchctl unload '/Library/${basedir}/${target}' || true"}
          else
            echo "creating service $(basename ${target} .plist)" >&2
          fi
          if test -L '/Library/${basedir}/${target}'; then
            rm '/Library/${basedir}/${target}'
          fi
          cp -f '${config.system.build.launchd}/Library/${basedir}/${target}' '/Library/${basedir}/${target}'
          ${lib.optionalString (
            target != "com.github.nlewo.comin.plist"
          ) "launchctl load -w '/Library/${basedir}/${target}'"}
        fi
      '';
      launchAgents = lib.filter (file: file.enable) (lib.attrValues config.environment.launchAgents);
      launchDaemons = lib.filter (file: file.enable) (lib.attrValues config.environment.launchDaemons);
    in
    lib.mkForce ''
      echo "setting up launchd services..." >&2

      ${lib.concatStringsSep "\n" (
        lib.mapAttrsToList (name: value: "launchctl setenv ${name} '${value}'") config.launchd.envVariables
      )}

      ${lib.concatMapStringsSep "\n" (file: launchdActivation "LaunchAgents" file.target) launchAgents}
      ${lib.concatMapStringsSep "\n" (file: launchdActivation "LaunchDaemons" file.target) launchDaemons}

      for f in /run/current-system/Library/LaunchAgents/*; do
        [[ -e "$f" ]] || break
        f=''${f#/run/current-system/Library/LaunchAgents/}
        if [[ ! -e "${config.system.build.launchd}/Library/LaunchAgents/$f" ]]; then
          echo "removing service $(basename "$f" .plist)" >&2
          launchctl unload "/Library/LaunchAgents/$f" || true
          rm -f "/Library/LaunchAgents/$f"
        fi
      done

      for f in /run/current-system/Library/LaunchDaemons/*; do
        [[ -e "$f" ]] || break
        f=''${f#/run/current-system/Library/LaunchDaemons/}
        if [[ ! -e "${config.system.build.launchd}/Library/LaunchDaemons/$f" ]]; then
          echo "removing service $(basename "$f" .plist)" >&2
          launchctl unload "/Library/LaunchDaemons/$f" || true
          rm -f "/Library/LaunchDaemons/$f"
        fi
      done
    '';

  # The deprecated activate-user shim invokes grep before nix-darwin sets an
  # activation PATH. Include the native paths required by that transition shim.
  launchd.daemons.comin.serviceConfig.EnvironmentVariables.PATH = lib.mkForce (
    lib.makeBinPath [
      config.nix.package
      pkgs.git
      pkgs.openssh
    ]
    + ":/usr/bin:/bin:/usr/sbin:/sbin"
  );
}
