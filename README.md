# Nix development environments

This repository defines four explicit, lock-pinned environments without requiring NixOS:

- `darwinConfigurations.personal-macos` — `pauldiloreto@aarch64-darwin`
- `darwinConfigurations.work-macos` — `paul.diloreto@aarch64-darwin`
- `homeConfigurations.personal-arch` — `docker@x86_64-linux`
- `homeConfigurations.personal-debian` — `proxmox@x86_64-linux`

Shared CLI tools, runtimes, Fish configuration, Neovim plugins/tooling, agent packages, and dotfiles are managed by Nix and Home Manager. macOS system settings and applications use nix-darwin. Homebrew is limited to the documented fallback casks, and MAS uses the Nix-provided `mas` CLI.

## Migration gate

The Nix implementation currently coexists with quarantined legacy automation so the existing machine is not dismantled before verification. Do not run legacy cleanup. The legacy trees and wrappers are removed only after all four outputs evaluate/build, the personal Mac switches successfully, smoke tests pass, the post-switch audit is reviewed, and CI passes. Normal Nix switches never remove unmanaged software.

## Install Nix and perform the first switch

The bootstrap scripts use the official multi-user installer at `https://nixos.org/nix/install`. They install no application/package manager other than Nix.

```bash
# Personal Mac (use work-macos as the optional argument on the work Mac)
./bootstrap/nix-macos.sh personal-macos

# Arch: first run `sudo pacman -Syu` and ensure native curl, Fish, and Git exist
./bootstrap/nix-arch.sh

# Debian: first run `sudo apt update && sudo apt upgrade`
# and ensure native curl, Fish, and Git exist
./bootstrap/nix-debian.sh
```

Before the first Home Manager activation, move any blocking Stow **directory** symlink reported by the activation guard to `<path>.before-nix-home-manager`, then create a real directory at the original path. Do not delete the link target. Preserve Fish secrets separately—for example, copy the legacy `conf.d/secrets.fish` into the new `~/.config/fish/conf.d/` and set mode `0600`—before retrying. This prevents recursive Home Manager targets from writing store links through Stow into this repository.

On Arch and Debian, Fish remains a native APT/Pacman package so `/usr/bin/fish` is a safe login shell. After installation, run `chsh -s /usr/bin/fish` once. Home Manager owns the Fish configuration and plugins but never edits `/etc/shells` or invokes APT/Pacman.

## Switch commands

```bash
./bin/nix-switch-personal-macos
./bin/nix-switch-work-macos
./bin/nix-switch-personal-arch
./bin/nix-switch-personal-debian
```

Configuration and dotfile changes are store-backed and take effect only after a rebuild.

## Updates

Activation never floats versions. `flake.lock`, npm dependency closures, and TWG release checksums change only through an explicit update target:

```bash
./bin/nix-update lock
./bin/nix-update pi 0.84.1
./bin/nix-update readseek 0.9.10
./bin/nix-update agents pi-subagents 0.45.1
./bin/nix-update agents all
./bin/nix-update twg 1.1.1
./bin/nix-update all
```

Review every lock/hash diff before switching.

Pi and every configured third-party Pi package are installed from a Nix-built npm closure. Settings reference only the store-backed local package; Pi does not need to populate `~/.pi/agent/npm` at startup.

## Validation

```bash
./bin/nix-validate
```

Validation formats/lints Nix, evaluates all hosts, builds Linux Home Manager activations and custom packages, checks immutable Fish/Neovim plugin policy, tests cleanup confirmation, and runs `git diff --check`. GitHub Actions performs Linux and macOS builds.

The pinned nixpkgs revision needs two narrow Darwin build workarounds: oxlint's `@napi-rs/cli` process probe is redirected from sandbox-blocked `/bin/ps` to Nix's store-backed `ps`, and only dependency-incompatible Snowflake tests are disabled while the remaining upstream suites run. Revisit both overrides when updating `nixpkgs`.

## Audit and cleanup

Audit is read-only and reports Nix state, Homebrew, MAS, application bundles and ownership, legacy globals, native packages, and migration artifacts:

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

- personal casks: `nextcloud`, `zen`, `wispr-flow`
- work casks: `nextcloud`, `wispr-flow`

Ordinary activation installs/upgrades desired casks, reports drift, and uses `cleanup = "none"` so unmanaged packages continue to exist.

MAS IDs are declared per host. Current IDs include Tailscale `1475387142`, Amphetamine `937984704`, and HP `1474276998`. If the App Store account is unavailable, activation warns, prints exact `mas install` follow-up commands, and continues. Credentials are never stored in Nix.

## Manual authentication and secrets

Keep secrets and authenticated sessions outside the Nix store:

- create `~/.config/fish/conf.d/00-secrets.fish` locally; Fish loads it through its standard `conf.d` mechanism;
- revoke and rotate the live credentials found in the excluded legacy Fish secrets file before treating the migration as complete;
- sign into the Mac App Store interactively;
- run `twg setup`/`twg login` manually on the work profile;
- authenticate GitHub, Azure, Snowflake, Pi providers, and other CLIs as needed.

### Known work-profile security exception

The owner explicitly accepted preserving the work profile's LiteLLM default at `http://192.168.0.100:4000/v1`. Its committed `settings.security.test.mjs` remains a documented expected failure and must not be represented as a passing security check; migration validation may proceed only with this recorded exception. Revisit the exception when that endpoint supports TLS or the default can move to the existing HTTPS `llm-hub` provider.

## Rollback and garbage collection

macOS:

```bash
nix run .#darwin-rebuild -- --list-generations
sudo nix run .#darwin-rebuild -- switch --rollback
```

Home Manager:

```bash
nix run .#home-manager -- generations
# Run the `activate` path printed for the generation you want.
```

nix-darwin optimizes the store automatically and runs weekly garbage collection, deleting generations/store paths older than 30 days.

## Linux ownership boundary

Arch and Debian are non-NixOS hosts. Nix does not own kernel/system updates, services, `/etc`, drivers, desktop integration, native package drift, or login-shell installation. Use `nix-native-package-audit` (add `--json` for JSON) for a read-only `pacman -Qqe` or `apt-mark showmanual` report.
