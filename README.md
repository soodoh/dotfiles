# Nix development environments

This repository defines two explicit, lock-pinned macOS environments:

- `darwinConfigurations.personal-macos` — `pauldiloreto@aarch64-darwin`
- `darwinConfigurations.work-macos` — `paul.diloreto@aarch64-darwin`

Shared CLI tools, runtimes, Fish configuration, Neovim plugins/tooling, agent packages, and dotfiles are managed by Nix and Home Manager. macOS system settings and applications use nix-darwin. Homebrew is limited to the documented fallback casks, and MAS uses the Nix-provided `mas` CLI.

## Reusable Home Manager layer

The platform-neutral user environment is exported as `homeModules.default`; the `personal` and `work` additions are exported under `homeModules` as well. Both Darwin configurations import those same modules, so Neovim and its plugins/tooling, Pi and its extensions, shared CLI packages, runtimes, Fish, and common dotfiles have one implementation.

Linux package outputs remain available for the reusable CLI/package layer even though this flake no longer declares standalone Linux hosts. A future NixOS configuration can apply `overlays.default`, pass compatible `host` metadata through Home Manager's extra special arguments, and import `homeModules.default` plus the desired profile module instead of copying the Darwin configuration or creating a parallel dependency list.

## Install and activate a configuration

All workstation installation and activation paths use the pinned flake. Clone the repository first:

```bash
git clone https://github.com/soodoh/dotfiles.git
cd dotfiles
```

The macOS bootstrap installs multi-user Nix from `https://nixos.org/nix/install` when needed, then activates exactly one declared configuration:

```bash
# Personal Mac; pass work-macos on the work Mac.
./bootstrap/nix-macos.sh personal-macos
```

## Apply configuration changes

Edit `flake.nix`, `nix/`, or `nix/dotfiles/`, validate the repository, review the diff, and switch the intended host:

```bash
./bin/nix-validate

./bin/nix-switch-personal-macos
./bin/nix-switch-work-macos
```

The wrappers run these flake-native commands:

```bash
sudo --set-home nix run .#darwin-rebuild -- switch --flake .#personal-macos
sudo --set-home nix run .#darwin-rebuild -- switch --flake .#work-macos
```

Configuration and dotfile changes are store-backed and take effect only after a successful rebuild. On macOS, activation keeps the existing primary user's login shell pointed at the Nix-managed Fish and reloads an active tmux server after Home Manager links the new configuration. Normal switches do not remove unmanaged software.

Pi settings that must remain writable are copied from the selected profile after every Home Manager activation. Pi can modify those live files between switches, but the next manual switch or Comin deployment replaces them with the committed configuration. Workflow run history under `~/.pi/workflows/projects` is preserved; declared saved workflows are replaced as a unit so repository deletions take effect.

## Automatic macOS deployment

Both Darwin configurations enable [Comin](https://github.com/nlewo/comin) as the root system launch daemon `com.github.nlewo.comin`. It polls the public, read-only HTTPS remote `https://github.com/soodoh/dotfiles.git` every 300 seconds while the Mac is awake. Only `main` is enabled: `host.name` sets `services.comin.hostname`, so each daemon evaluates and switches only its matching output (`darwinConfigurations.personal-macos` or `darwinConfigurations.work-macos`). Failed evaluations or builds are recorded but never switched over, leaving the current system generation active.

The launchd plist calls the stable `/run/current-system/sw/bin/comin-supervisor` path instead of generation-specific store paths. The supervisor runs the generation-specific Comin binary and configuration, then re-execs itself after a successful deployment has been persisted. Routine deployments therefore leave the plist unchanged and keep nix-darwin's normal launchd reconciliation intact. An unattended generation that would change the plist fails before launchd reconciliation and must be applied with a manual switch.

The first existing bootstrap or manual switch is intentionally built from the local checkout. That activation installs and starts Comin with launchd `RunAtLoad` and `KeepAlive`; subsequent deployments use Comin's root-owned state and bare repository under `/var/lib/comin`, not the developer checkout. Run one appropriate entrypoint after this configuration reaches each Mac:

```bash
# Personal
./bootstrap/nix-macos.sh personal-macos  # for a new installation
./bin/nix-switch-personal-macos          # for an existing installation

# Work
./bootstrap/nix-macos.sh work-macos      # for a new installation
./bin/nix-switch-work-macos              # for an existing installation
```

Every commit that reaches `main` is eligible for automatic deployment. Comin does not require commit signatures, so direct pushes and merged pull requests are handled identically. Run `./bin/nix-validate` before pushing when a local preflight is desired.

Automatic deployment does not run `nix-update`, change `flake.lock`, remove unmanaged software, update macOS, or alter the existing Homebrew/MAS activation behavior. Existing nix-darwin generations, weekly GC policy, and rollback remain in place; Comin's default retention additionally keeps multiple successful deployment records and GC roots.

Future changes to Comin's plist, including relevant nix-darwin serialization changes, also require an explicit manual switch; unattended activation prints the required action and leaves the running generation in place.

Inspect or trigger Comin with:

```bash
sudo launchctl print system/com.github.nlewo.comin
sudo /run/current-system/sw/bin/comin status
sudo /run/current-system/sw/bin/comin deployment latest
sudo tail -n 200 /var/log/comin.log

# Fetch now instead of waiting for the next poll.
sudo /run/current-system/sw/bin/comin fetch

# Restart the launch daemon if diagnosis requires it.
sudo launchctl kickstart -k system/com.github.nlewo.comin

# Show the Git revision embedded by nix-darwin and list generations.
darwin-version --configuration-revision
nix run .#darwin-rebuild -- --list-generations
```

To hold the machine on a rolled-back generation, suspend Comin before using the existing rollback command, then resume it when `main` is ready to deploy again:

```bash
sudo /run/current-system/sw/bin/comin suspend
sudo --set-home nix run .#darwin-rebuild -- switch --rollback
sudo /run/current-system/sw/bin/comin resume
```

## Updates

Activation uses only versions available from pinned sources. `flake.lock` pins Nix inputs, Homebrew itself, and immutable Homebrew tap snapshots. Renovate updates the canonical Pi-extension manifest and npm lockfile together in reviewable pull requests. Manual update targets remain available for flake inputs, bundled Pi packages, and TWG release checksums:

```bash
./bin/nix-update lock
./bin/nix-update agents pi-readseek 0.9.10
./bin/nix-update agents pi-subagents 0.45.1
./bin/nix-update agents all
./bin/nix-update twg 1.1.1
./bin/nix-update all
```

Review every lockfile diff before switching.

Renovate also updates root flake inputs, including the Homebrew cask taps. Do not run `brew update` or `brew upgrade`; pull the reviewed `main` branch and switch instead. Homebrew upgrades during activation can only use package definitions from the locked tap snapshots.

Mac App Store updates are intentionally excluded from activation so unrelated apps are not upgraded. After signing into the App Store, install or update only the declared IDs with:

```bash
# Personal profile
mas install 1475387142 937984704 1474276998
mas update 1475387142 937984704 1474276998

# Work profile
mas install 937984704
mas update 937984704
```

Pi and every configured third-party Pi package are installed from a Nix-built npm closure. Settings reference only the store-backed local package; Pi does not need to populate `~/.pi/agent/npm` at startup.

## Validation

Install the tracked Git hooks after cloning or whenever the hook setup changes:

```bash
corepack npm ci
corepack npm exec -- lefthook install
```

Run comprehensive validation explicitly with:

```bash
./bin/nix-validate
```

GitHub Actions runs formatting, static analysis, all-system package/check evaluation, and Linux-native checks on Ubuntu. A separate hosted Apple Silicon job fully realizes both Darwin configurations plus the Comin deployment and launchd-boundary checks. The workflow runs for pull requests and pushes to `main`, but does not gate direct pushes.

`./bin/nix-validate` provides the same comprehensive validation as an explicit local preflight for the current platform. Lefthook only enforces commit-message formatting, so run the validation explicitly before pushing changes that should be checked prior to automatic deployment.

## Audit

Audit is side-effect free and reports declared state, software and configuration outside Nix ownership, and declared Homebrew or MAS applications that are missing. It never removes anything:

```bash
./bin/nix-audit personal-macos
# equivalent
nix run .#audit -- personal-macos

# Persist machine-readable output explicitly when needed.
./bin/nix-audit personal-macos --json > audit.json
```

External items may be intentional, especially applications installed by corporate management. Review the report and handle them manually if desired.

## macOS package sources

Nix owns the CLI environment and maintained macOS packages. Homebrew owns only the fallback casks below; Homebrew itself and every package tap are immutable inputs pinned by `flake.lock`. There are no Homebrew formulas:

- personal casks: `nextcloud`, `prusaslicer`, `wispr-flow`, `zen`
- work casks: `nextcloud`, `snowflakedb/snowflake-cli/snowflake-cli`, `wispr-flow`, `zen`

Ordinary activation installs/upgrades desired casks only from the locked tap revisions and uses `cleanup = "none"`, so unmanaged packages continue to exist. Tap metadata and installer checksums are reproducible from `flake.lock`; applications with built-in self-updaters can still update themselves outside Homebrew.
MAS IDs are declared per host. Current IDs include Tailscale `1475387142`, Amphetamine `937984704`, and HP `1474276998`. If the App Store account is unavailable, activation warns and skips App Store work; use the exact profile-specific commands above after signing in. Credentials are never stored in Nix.

## Containers

Nix installs Colima, Docker, and Compose. Home Manager manages `~/.colima/default/colima.yaml` as a store-backed symlink while Colima's runtime state remains writable, and the user launchd agent starts Colima at login with the Docker runtime, Apple Virtualization, VirtioFS, and Rosetta enabled.

## Manual authentication and secrets

Keep secrets and authenticated sessions outside the Nix store:

- create `~/.config/fish/conf.d/00-secrets.fish` locally; Fish loads it through its standard `conf.d` mechanism;
- keep API credentials only in that local mode-`0600` file and never commit it;
- sign into the Mac App Store interactively;
- run `twg setup`/`twg login` manually on the work profile;
- authenticate GitHub, Azure, Snowflake, Pi providers, and other CLIs as needed.

### Known work-profile security exception

The owner explicitly accepted preserving the work profile's LiteLLM default at `http://192.168.0.100:4000/v1`. Its committed `settings.security.test.mjs` remains a documented expected failure and must not be represented as a passing security check; repository validation may proceed only with this recorded exception. Revisit the exception when that endpoint supports TLS.

## Rollback and garbage collection

macOS:

```bash
nix run .#darwin-rebuild -- --list-generations
sudo --set-home nix run .#darwin-rebuild -- switch --rollback
```

nix-darwin optimizes the store automatically and runs weekly garbage collection, deleting generations/store paths older than 30 days.
