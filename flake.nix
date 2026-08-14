{
  description = "Pinned cross-platform development environments without NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    nix-darwin = {
      url = "github:nix-darwin/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    comin = {
      url = "github:nlewo/comin";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    nix-homebrew.url = "github:zhaofengli/nix-homebrew";

    homebrew-core = {
      url = "github:Homebrew/homebrew-core";
      flake = false;
    };

    homebrew-cask = {
      url = "github:Homebrew/homebrew-cask";
      flake = false;
    };

    homebrew-snowflake-cli = {
      url = "github:snowflakedb/homebrew-snowflake-cli";
      flake = false;
    };

  };

  outputs =
    inputs@{
      nixpkgs,
      nix-darwin,
      comin,
      home-manager,
      nix-homebrew,
      ...
    }:
    let
      inherit (nixpkgs) lib;
      supportedSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = lib.genAttrs supportedSystems;

      hosts = {
        personal-macos = import ./nix/hosts/personal-macos;
        work-macos = import ./nix/hosts/work-macos;
        personal-arch = import ./nix/hosts/personal-arch;
        personal-debian = import ./nix/hosts/personal-debian;
      };

      allowedUnfreePackages = [
        "discord"
        "google-chrome"
        "git-conflict.nvim"
        "lunar"
        "obsidian"
        "rar"
        "slack"
        "twg"
        "zoom"
      ];
      allowUnfreePredicate = package: lib.elem (lib.getName package) allowedUnfreePackages;

      dotfilesOverlay = final: _previous: {
        dotfilesPackages = import ./nix/packages { pkgs = final; };
      };

      mkPkgs =
        system:
        import nixpkgs {
          inherit system;
          overlays = [
            dotfilesOverlay
          ];
          config = { inherit allowUnfreePredicate; };
        };

      mkDarwin =
        host:
        nix-darwin.lib.darwinSystem {
          specialArgs = {
            inherit
              allowUnfreePredicate
              host
              inputs
              ;
          };
          modules = [
            nix-homebrew.darwinModules.nix-homebrew
            comin.darwinModules.comin
            home-manager.darwinModules.home-manager
            ./nix/modules/darwin
          ];
        };

      mkHome =
        host:
        home-manager.lib.homeManagerConfiguration {
          pkgs = mkPkgs host.system;
          extraSpecialArgs = { inherit host inputs; };
          modules = [
            ./nix/modules/common
            ./nix/modules/linux
            ./nix/modules/profiles/${host.profile}.nix
          ];
        };

      darwinConfigurations = {
        personal-macos = mkDarwin hosts.personal-macos;
        work-macos = mkDarwin hosts.work-macos;
      };

      homeConfigurations = {
        personal-arch = mkHome hosts.personal-arch;
        personal-debian = mkHome hosts.personal-debian;
      };
    in
    {
      inherit darwinConfigurations homeConfigurations;

      overlays.default = dotfilesOverlay;

      packages = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
          custom = pkgs.dotfilesPackages;
          scripts = import ./nix/scripts { inherit pkgs; };
        in
        custom
        // {
          nix-audit = scripts.audit;
          inherit (pkgs) deadnix statix;
          pi = pkgs.pi-coding-agent;
          default = pkgs.pi-coding-agent;
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
          scripts = import ./nix/scripts { inherit pkgs; };
        in
        {
          audit = {
            type = "app";
            program = "${scripts.audit}/bin/nix-audit";
            meta.description = "Report declared, external, and missing system state.";
          };
          home-manager = {
            type = "app";
            program = "${home-manager.packages.${system}.default}/bin/home-manager";
            meta.description = "Run Home Manager for a declared user configuration.";
          };
        }
        // lib.optionalAttrs (lib.hasSuffix "-darwin" system) {
          darwin-rebuild = {
            type = "app";
            program = "${nix-darwin.packages.${system}.default}/bin/darwin-rebuild";
            meta.description = "Run nix-darwin rebuild commands for a declared macOS configuration.";
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
          scripts = import ./nix/scripts { inherit pkgs; };
          policySource = ./nix;
        in
        {

          immutable-plugin-policy =
            pkgs.runCommand "immutable-plugin-policy" { nativeBuildInputs = [ pkgs.ripgrep ]; }
              ''
                if rg -n 'fisher (install|update)|Lazy!? sync|MasonToolsInstall|TSUpdate|git clone.*lazy.nvim|git clone.*tmux-plugins/tpm' ${policySource}; then
                  echo >&2 "mutable plugin installation remains in Nix-managed sources"
                  exit 1
                fi
                if rg -n '"npm:' ${policySource}/dotfiles; then
                  echo >&2 "mutable Pi npm package installation remains in Nix-managed settings"
                  exit 1
                fi
                if rg -n '"command":\s*"npx"' ${policySource}/dotfiles; then
                  echo >&2 "mutable MCP npx execution remains in Nix-managed settings"
                  exit 1
                fi
                touch "$out"
              '';

          audit-external-state =
            pkgs.runCommand "audit-external-state"
              {
                nativeBuildInputs = [
                  scripts.audit
                  pkgs.jq
                ];
              }
              ''
                export HOME="$TMPDIR/home"
                mkdir -p \
                  "$HOME/.local/share/fnm/aliases/default/bin" \
                  "$HOME/.bun/bin" \
                  "$HOME/.bun/install/global/node_modules" \
                  "$HOME/.cargo/bin" \
                  "$HOME/.local/bin" \
                  "$HOME/fake-bin"

                cat > "$HOME/.local/share/fnm/aliases/default/bin/node" <<'EOF'
                #!/bin/sh
                printf '%s\n' '{"dependencies":{"corepack":{},"npm":{}}}'
                EOF
                cat > "$HOME/.local/share/fnm/aliases/default/bin/npm" <<'EOF'
                #!/bin/sh
                exit 0
                EOF
                cat > "$HOME/.bun/bin/bun" <<'EOF'
                #!/bin/sh
                test "$BUN_INSTALL" = "$HOME/.bun"
                printf '%s\n' "$HOME/.bun/install/global node_modules (1)" '└── demo@1.0.0'
                EOF
                cat > "$HOME/.cargo/bin/cargo" <<'EOF'
                #!/bin/sh
                printf '%s\n' 'yazi-cli v1.0.0:' '    ya'
                EOF
                cat > "$HOME/.cargo/.crates2.json" <<'EOF'
                {"installs":{"yazi-cli 1.0.0 (registry+https://github.com/rust-lang/crates.io-index)":{}}}
                EOF
                cat > "$HOME/.local/bin/uv" <<'EOF'
                #!/bin/sh
                printf '%s\n' 'ruff v1.0.0'
                EOF
                cat > "$HOME/fake-bin/brew" <<'EOF'
                #!/bin/sh
                case "$1:$2" in
                  list:--formula) printf '%s\n' legacy-formula ;;
                  list:--cask) printf '%s\n' legacy-cask ;;
                  tap:*) printf '%s\n' legacy/tap ;;
                  info:*) printf '%s\n' '{"casks":[]}' ;;
                esac
                EOF
                chmod +x \
                  "$HOME/.local/share/fnm/aliases/default/bin/node" \
                  "$HOME/.local/share/fnm/aliases/default/bin/npm" \
                  "$HOME/.bun/bin/bun" \
                  "$HOME/.cargo/bin/cargo" \
                  "$HOME/.local/bin/uv" \
                  "$HOME/fake-bin/brew"
                export PATH="$HOME/fake-bin:$PATH"

                nix-audit personal-macos --json > report.json
                jq -e '
                  .schemaVersion == 2 and
                  .external.homebrew.formulae == ["legacy-formula"] and
                  .external.homebrew.casks == ["legacy-cask"] and
                  .external.homebrew.taps == ["legacy/tap"] and
                  .external.globalPackages.npm == ["corepack", "npm"] and
                  .external.globalPackages.bun == ["demo"] and
                  .external.globalPackages.cargo == ["yazi-cli"] and
                  .external.globalPackages.uv == ["ruff"] and
                  (.missing.homebrewCasks | index("nextcloud") != null)
                ' report.json
                touch "$out"
              '';

        }
        // lib.optionalAttrs (system == "x86_64-linux") {
          personal-arch = homeConfigurations.personal-arch.activationPackage;
          personal-debian = homeConfigurations.personal-debian.activationPackage;
        }
        // lib.optionalAttrs (system == "aarch64-darwin") {
          personal-macos = darwinConfigurations.personal-macos.system;
          work-macos = darwinConfigurations.work-macos.system;
          comin-deployment-config =
            let
              isValid =
                hostname:
                let
                  hostConfig = darwinConfigurations.${hostname}.config;
                  cominConfig = hostConfig.services.comin;
                  remoteCount = builtins.length cominConfig.remotes;
                  remote = lib.head cominConfig.remotes;
                in
                cominConfig.enable
                && cominConfig.hostname == hostname
                && cominConfig.buildTimeout == 7200
                && remoteCount == 1
                && remote.name == "origin"
                && remote.url == "https://github.com/soodoh/dotfiles.git"
                && remote.branches.main.name == "main"
                && remote.branches.main.operation == "switch"
                && remote.branches.testing.name == ""
                && remote.poller.period == 300
                && hostConfig.launchd.daemons.comin.command == "/run/current-system/sw/bin/comin-supervisor";
            in
            assert lib.assertMsg (isValid "personal-macos")
              "personal-macos has an invalid Comin deployment configuration";
            assert lib.assertMsg (isValid "work-macos")
              "work-macos has an invalid Comin deployment configuration";
            pkgs.runCommand "comin-deployment-config" { } ''
              touch "$out"
            '';
          comin-darwin-activation =
            let
              workConfig = darwinConfigurations.work-macos.config;
              cominEnvironment = workConfig.launchd.daemons.comin.serviceConfig.EnvironmentVariables;
              cominPath = cominEnvironment.PATH;
              corporateCertificate = "/Library/Application Support/DocuSign/zscaler-ca-bundle.pem";
              cominPlist = workConfig.environment.launchDaemons."com.github.nlewo.comin.plist".source;
              cominYaml =
                (import "${comin}/nix/comin-config.nix" {
                  config = workConfig;
                  inherit pkgs lib;
                }).cominConfigYaml;
              homeApps =
                workConfig.home-manager.users."paul.diloreto".home.file."Applications/Home Manager Apps".source;
            in
            pkgs.runCommand "comin-darwin-activation" { } ''
              test -d '${homeApps}'
              grep -F '/run/current-system/sw/bin/comin-supervisor' '${cominPlist}'
              if grep -E '/nix/store/[^ ]+-(comin|comin-supervisor)' '${cominPlist}'; then
                echo >&2 "Comin launchd command is generation-specific"
                exit 1
              fi
              grep -F 'post_deployment_command:' '${cominYaml}'
              grep -F '/bin/kill -HUP "$COMIN_SUPERVISOR_PID"' '${workConfig.services.comin.postDeploymentCommand}'
              grep -F '/bin/ps -p "$PPID" -o command=' '${workConfig.system.build.toplevel}/activate'
              grep -F "grep -Eq '(^|/)comin( |$)'" '${workConfig.system.build.toplevel}/activate'
              grep -F '/usr/bin/cmp -s' '${workConfig.system.build.toplevel}/activate'
              checks_line="$(grep -n '/bin/ps -p \"$PPID\" -o command=' '${workConfig.system.build.toplevel}/activate' | cut -d: -f1)"
              launchd_line="$(grep -n 'setting up launchd services' '${workConfig.system.build.toplevel}/activate' | cut -d: -f1)"
              test "$checks_line" -lt "$launchd_line"
              test '${cominPath}' = '/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin'
              test '${cominEnvironment.NIX_SSL_CERT_FILE}' = '${corporateCertificate}'
              test '${cominEnvironment.SSL_CERT_FILE}' = '${corporateCertificate}'
              test '${cominEnvironment.GIT_SSL_CAINFO}' = '${corporateCertificate}'
              test '${cominEnvironment.CURL_CA_BUNDLE}' = '${corporateCertificate}'
              if rg -U 'system\.activationScripts\.launchd[[:space:]]*=' ${./nix/modules/darwin/comin.nix}; then
                echo >&2 "Comin still overrides nix-darwin launchd activation"
                exit 1
              fi
              touch "$out"
            '';
        }
      );

      formatter = forAllSystems (system: (mkPkgs system).nixfmt-tree);

      devShells = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [
              pkgs.deadnix
              pkgs.git
              pkgs.jq
              pkgs.nixfmt-tree
              pkgs.shellcheck
              pkgs.statix
            ];
          };
        }
      );
    };
}
