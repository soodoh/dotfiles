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

    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{
      nixpkgs,
      nix-darwin,
      comin,
      home-manager,
      nix-homebrew,
      fenix,
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

      dotfilesOverlay = final: previous: {
        dotfilesPackages = import ./nix/packages { pkgs = final; };

        # TODO: Return to previous.oxlint once @napi-rs/cli's Darwin /bin/ps fix
        # is available in nixpkgs and its oxlint build is publicly cached.
        oxlint =
          if final.stdenv.hostPlatform.isDarwin then final.dotfilesPackages.oxlint-npm else previous.oxlint;

      };

      mkPkgs =
        system:
        import nixpkgs {
          inherit system;
          overlays = [
            fenix.overlays.default
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
          nix-cleanup = scripts.cleanup;
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
          };
          cleanup = {
            type = "app";
            program = "${scripts.cleanup}/bin/nix-cleanup";
          };
          home-manager = {
            type = "app";
            program = "${home-manager.packages.${system}.default}/bin/home-manager";
          };
        }
        // lib.optionalAttrs (lib.hasSuffix "-darwin" system) {
          darwin-rebuild = {
            type = "app";
            program = "${nix-darwin.packages.${system}.default}/bin/darwin-rebuild";
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
          custom = pkgs.dotfilesPackages;
          scripts = import ./nix/scripts { inherit pkgs; };
          cleanSource = import ./nix/lib/clean-source.nix { inherit lib; };
          policySource = cleanSource ./nix;
        in
        {
          pi-smoke = pkgs.pi-coding-agent;
          twg-smoke = custom.twg;
          inherit (custom) pi-extensions;

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
                touch "$out"
              '';

          dotfile-targets = pkgs.runCommand "dotfile-targets" { } ''
            test -f ${policySource}/dotfiles/common/.config/nvim/init.lua
            test -f ${policySource}/dotfiles/common/.config/fish/custom/conf.d/abbreviations.fish
            test -f ${policySource}/dotfiles/common/.config/atuin/config.toml
            test -f ${policySource}/dotfiles/common/.config/tmux/tmux.conf
            test -f ${policySource}/dotfiles/darwin/.config/aerospace/aerospace.toml
            test -f ${policySource}/dotfiles/profiles/personal/.pi/agent/settings.json
            test -f ${policySource}/dotfiles/profiles/work/.pi/agent/settings.json
            touch "$out"
          '';

          audit-legacy-discovery =
            pkgs.runCommand "audit-legacy-discovery"
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
                  "$HOME/fake-bin" \
                  "$HOME/fake-cellar/sketchybar/1.0.0"

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
                cat > "$HOME/fake-cellar/sketchybar/1.0.0/INSTALL_RECEIPT.json" <<'EOF'
                {"installed_on_request":true,"source":{"tap":"legacy/tap"}}
                EOF
                cat > "$HOME/fake-bin/brew" <<'EOF'
                #!/bin/sh
                case "$1" in
                  leaves) printf '%s\n' legacy-formula ;;
                  --cellar) printf '%s\n' "$HOME/fake-cellar" ;;
                  list) printf '%s\n' legacy-cask ;;
                  tap) printf '%s\n' legacy/tap ;;
                  info) printf '%s\n' '{"casks":[]}' ;;
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
                  .observed.homebrew.formulae == ["legacy-formula", "legacy/tap/sketchybar"] and
                  .observed.homebrew.casks == ["legacy-cask"] and
                  .observed.homebrew.taps == ["legacy/tap"] and
                  .observed.legacyGlobals.npm == ["corepack", "npm"] and
                  .observed.legacyGlobals.bun == ["demo"] and
                  .observed.legacyGlobals.cargo == ["yazi-cli"] and
                  .observed.legacyGlobals.uv == ["ruff"]
                ' report.json
                touch "$out"
              '';

          cleanup-confirmation =
            pkgs.runCommand "cleanup-confirmation" { nativeBuildInputs = [ scripts.cleanup ]; }
              ''
                export HOME="$TMPDIR/home"
                mkdir -p "$HOME"
                export NIX_DOTFILES_AUDIT_FIXTURE=${./nix/scripts/fixtures/audit-personal-macos.json}
                set +e
                nix-cleanup personal-macos </dev/null > cleanup.log 2>&1
                status=$?
                set -e
                test "$status" -eq 3
                grep -F "Cleanup cancelled; nothing was removed." cleanup.log
                grep -F "legacy-app" cleanup.log
                grep -F "legacy/tap" cleanup.log
                grep -F "Docker Desktop is protected" cleanup.log
                grep -F "Homebrew casks: legacy-app" cleanup.log
                grep -F "MAS fallback casks are protected until desired MAS apps are installed: missing-app" cleanup.log
                if grep -E 'Homebrew casks:.*missing-app' cleanup.log; then exit 1; fi
                grep -F "Application bundles without identifiers are protected: /Applications/Unknown.app" cleanup.log
                if grep -E 'Homebrew casks:.*(corporate-app|desired-cask)' cleanup.log; then exit 1; fi
                if grep -E 'Homebrew taps:.*corporate/tap' cleanup.log; then exit 1; fi
                if grep -E 'Application bundles:.*(Corporate|Unknown)\\.app' cleanup.log; then exit 1; fi
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
                  cominConfig = darwinConfigurations.${hostname}.config.services.comin;
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
                && remote.poller.period == 300;
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
              cominPath = workConfig.launchd.daemons.comin.serviceConfig.EnvironmentVariables.PATH;
              homeApps =
                workConfig.home-manager.users."paul.diloreto".home.file."Applications/Home Manager Apps".source;
            in
            pkgs.runCommand "comin-darwin-activation" { } ''
              if grep -F "launchctl unload '/Library/LaunchDaemons/com.github.nlewo.comin.plist'" ${workConfig.system.build.toplevel}/activate; then
                echo >&2 "Comin activation still unloads its own launchd service"
                exit 1
              fi
              if grep -F '/Applications/Nix Apps' ${workConfig.system.build.toplevel}/activate; then
                echo >&2 "root activation still manages protected application bundles"
                exit 1
              fi
              test -d '${homeApps}'
              test '${cominPath}' = '${
                lib.makeBinPath [
                  workConfig.nix.package
                  pkgs.git
                  pkgs.openssh
                ]
              }:/usr/bin:/bin:/usr/sbin:/sbin'
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
