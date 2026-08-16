{
  description = "Pinned personal and work macOS development environments";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    nix-darwin = {
      url = "github:nix-darwin/nix-darwin";
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
      home-manager,
      nix-homebrew,
      ...
    }:
    let
      inherit (nixpkgs) lib;
      packageSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = lib.genAttrs packageSystems;

      hosts = {
        personal-macos = import ./nix/hosts/personal-macos;
        work-macos = import ./nix/hosts/work-macos;
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
            home-manager.darwinModules.home-manager
            ./nix/modules/darwin
          ];
        };

      darwinConfigurations = {
        personal-macos = mkDarwin hosts.personal-macos;
        work-macos = mkDarwin hosts.work-macos;
      };

    in
    {
      inherit darwinConfigurations;

      overlays.default = dotfilesOverlay;

      homeModules = {
        default = ./nix/modules/common;
        personal = ./nix/modules/profiles/personal.nix;
        work = ./nix/modules/profiles/work.nix;
      };

      packages = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
          custom = pkgs.dotfilesPackages;
          scripts = import ./nix/scripts { inherit pkgs; };
        in
        custom
        // {
          inherit (pkgs) deadnix statix;
          pi = pkgs.pi-coding-agent;
          default = pkgs.pi-coding-agent;
        }
        // lib.optionalAttrs (lib.hasSuffix "-darwin" system) {
          nix-audit = scripts.audit;
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
          scripts = import ./nix/scripts { inherit pkgs; };
        in
        lib.optionalAttrs (lib.hasSuffix "-darwin" system) {
          audit = {
            type = "app";
            program = "${scripts.audit}/bin/nix-audit";
            meta.description = "Report declared, external, and missing system state.";
          };
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
                  .schemaVersion == 4 and
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
        // lib.optionalAttrs (system == "aarch64-darwin") {
          personal-macos = darwinConfigurations.personal-macos.system;
          work-macos = darwinConfigurations.work-macos.system;
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
