# Nix development environments

This repository defines four explicit, lock-pinned environments without requiring NixOS:

- `darwinConfigurations.personal-macos` — `pauldiloreto@aarch64-darwin`
- `darwinConfigurations.work-macos` — `paul.diloreto@aarch64-darwin`
- `homeConfigurations.personal-arch` — `docker@x86_64-linux`
- `homeConfigurations.personal-debian` — `proxmox@x86_64-linux`

Shared CLI tools, runtimes, Fish configuration, Neovim plugins/tooling, agent packages, and dotfiles are managed by Nix and Home Manager. macOS system settings and applications use nix-darwin. Homebrew is limited to the documented fallback casks, and MAS uses the Nix-provided `mas` CLI.

## Install and activate a configuration

All workstation installation and activation paths use the pinned flake. Clone the repository first:

```bash
git clone https://github.com/soodoh/dotfiles.git
cd dotfiles
```

The bootstrap scripts install multi-user Nix from `https://nixos.org/nix/install` when needed, then activate exactly one declared configuration:

```bash
# Personal Mac; pass work-macos on the work Mac.
./bootstrap/nix-macos.sh personal-macos

# Arch: first install native curl, Fish, and Git.
./bootstrap/nix-arch.sh

# Debian: first install native curl, Fish, and Git.
./bootstrap/nix-debian.sh
```

On Arch and Debian, Fish remains a native APT/Pacman package so `/usr/bin/fish` is a safe login shell. Run `chsh -s /usr/bin/fish` once after installation. Home Manager owns Fish configuration and plugins but does not edit `/etc/shells` or manage operating-system packages.

## Apply configuration changes

Edit `flake.nix`, `nix/`, or `nix/dotfiles/`, validate the repository, review the diff, and switch the intended host:

```bash
./bin/nix-validate

./bin/nix-switch-personal-macos
./bin/nix-switch-work-macos
./bin/nix-switch-personal-arch
./bin/nix-switch-personal-debian
```

The wrappers run these flake-native commands:

```bash
# macOS
sudo --set-home nix run .#darwin-rebuild -- switch --flake .#personal-macos
sudo --set-home nix run .#darwin-rebuild -- switch --flake .#work-macos

# Linux
nix run .#home-manager -- switch --flake .#personal-arch
nix run .#home-manager -- switch --flake .#personal-debian
```

Configuration and dotfile changes are store-backed and take effect only after a successful rebuild. On macOS, activation keeps the existing primary user's login shell pointed at the Nix-managed Fish and reloads an active tmux server after Home Manager links the new configuration. Normal switches do not remove unmanaged software.

## Updates

Activation never floats versions. `flake.lock`, npm dependency closures, and TWG release checksums change only through an explicit update target:

```bash
./bin/nix-update lock
./bin/nix-update agents pi-readseek 0.9.10
./bin/nix-update agents pi-subagents 0.45.1
./bin/nix-update agents all
./bin/nix-update twg 1.1.1
./bin/nix-update all
```

Review every lock/hash diff before switching.

Pi and every configured third-party Pi package are installed from a Nix-built npm closure. Settings reference only the store-backed local package; Pi does not need to populate `~/.pi/agent/npm` at startup.

## Validation

Install the tracked Git hooks after cloning or whenever the hook setup changes:

```bash
bunx lefthook install
```

Run comprehensive validation explicitly with:

```bash
./bin/nix-validate
```

General GitHub Actions CI formats and statically analyzes the Nix code, evaluates all four host configurations, and builds only the lightweight Linux policy and script checks. Complete host realization is intentionally omitted from general CI.

`./bin/nix-validate` fully builds every configuration for the current platform: both Darwin configurations on macOS or both Home Manager configurations on Linux. It also builds the custom packages and checks for that platform. Lefthook runs this comprehensive command before pushes containing relevant Nix-managed changes; a validation failure blocks the push unless an emergency push intentionally uses `git push --no-verify`.

Cross-platform realization remains platform-specific: Darwin cannot natively build the Linux configurations, and Linux cannot natively build the Darwin configurations. Cross-platform configurations still receive evaluation-only coverage.

The pinned nixpkgs revision needs two narrow Darwin build workarounds: oxlint's `@napi-rs/cli` process probe is redirected from sandbox-blocked `/bin/ps` to Nix's store-backed `ps`, and only dependency-incompatible Snowflake tests are disabled while the remaining upstream suites run. Revisit both overrides when updating `nixpkgs`.

## Audit and cleanup

Audit is read-only and reports Nix state, Homebrew, MAS, application bundles and ownership, obsolete globals and directories, and native packages:

```bash
./bin/nix-audit personal-macos
# equivalent
nix run .#audit -- personal-macos
```

Cleanup is never part of activation. It always regenerates an audit/plan, prints exact removals, and requires typing `CLEAN`:

```bash
./bin/nix-cleanup personal-macos
# equivalent
nix run .#cleanup -- personal-macos
```

Cleanup protects Apple/system apps, leaves APT/Pacman report-only, and refuses legacy global removal unless Nix replacements are active. Docker Desktop remains protected unless these fresh checks all pass:

Home Manager materializes the default Colima profile at `~/.colima/default/colima.yaml` from a store-backed source with the Docker runtime, Apple Virtualization, VirtioFS, and Rosetta enabled. The runtime copy remains user-writable because Colima updates it during startup. Starting the VM remains an explicit user action.

```bash
colima start
docker run --rm hello-world
docker compose version
```

Review the plan even with these safeguards. Moving an application to Trash does not remove vendor support files or privileged helpers.

## macOS package sources

Nix owns the CLI environment and maintained macOS packages. Homebrew is the less-reproducible exception and has no formulas:

- personal casks: `nextcloud`, `prusaslicer`, `wispr-flow`, `zen`
- work casks: `nextcloud`, `wispr-flow`, `zen`

Ordinary activation installs/upgrades desired casks, reports drift, and uses `cleanup = "none"` so unmanaged packages continue to exist.

MAS IDs are declared per host. Current IDs include Tailscale `1475387142`, Amphetamine `937984704`, and HP `1474276998`. If the App Store account is unavailable, activation warns, prints exact `mas install` follow-up commands, and continues. Credentials are never stored in Nix. Cleanup protects a declared Homebrew fallback cask until its desired MAS app is actually installed.

## Manual authentication and secrets

Keep secrets and authenticated sessions outside the Nix store:

- create `~/.config/fish/conf.d/00-secrets.fish` locally; Fish loads it through its standard `conf.d` mechanism;
- keep API credentials only in that local mode-`0600` file and never commit it;
- sign into the Mac App Store interactively;
- run `twg setup`/`twg login` manually on the work profile;
- authenticate GitHub, Azure, Snowflake, Pi providers, and other CLIs as needed.

### Known work-profile security exception

The owner explicitly accepted preserving the work profile's LiteLLM default at `http://192.168.0.100:4000/v1`. Its committed `settings.security.test.mjs` remains a documented expected failure and must not be represented as a passing security check; repository validation may proceed only with this recorded exception. Revisit the exception when that endpoint supports TLS or the default can move to the existing HTTPS `llm-hub` provider.

## Rollback and garbage collection

macOS:

```bash
nix run .#darwin-rebuild -- --list-generations
sudo --set-home nix run .#darwin-rebuild -- switch --rollback
```

Home Manager:

```bash
nix run .#home-manager -- generations
# Run the `activate` path printed for the generation you want.
```

nix-darwin optimizes the store automatically and runs weekly garbage collection, deleting generations/store paths older than 30 days.

## Linux ownership boundary

Arch and Debian are non-NixOS hosts. Nix does not own kernel/system updates, services, `/etc`, drivers, desktop integration, native package drift, or login-shell installation. Use `nix-native-package-audit` (add `--json` for JSON) for a read-only `pacman -Qqe` or `apt-mark showmanual` report.
