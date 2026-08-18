# mise development environments

This repository is the canonical configuration for two explicit macOS profiles:

- `personal-macos`
- `work-macos`

The shared mise layer owns pinned runtimes, portable tools, common dotfiles, macOS defaults, packages, LaunchAgents, and lifecycle tasks. Each profile owns its identity, Pi configuration, complete agent skill catalog, applications, and credential policy.

## Prerequisite

Install mise using the [official instructions](https://mise.jdx.dev/getting-started.html), clone this repository, and trust it:

```bash
mkdir -p ~/Projects
git clone https://github.com/soodoh/dotfiles.git ~/Projects/dotfiles
cd ~/Projects/dotfiles
mise trust
```

Copy the backed-up age identity file from Bitwarden, then save it with restricted permissions:

```bash
mkdir -p ~/.config/mise
pbpaste > ~/.config/mise/age.txt
chmod 600 ~/.config/mise/age.txt
```

There is no default profile. Always select one explicitly:

```bash
mise --env personal-macos run status
MISE_ENV=personal-macos mise bootstrap

# Or on the work Mac:
mise --env work-macos run status
MISE_ENV=work-macos mise bootstrap
```

## Bootstrap behavior

Mise natively manages:

- system packages, casks, and App Store applications;
- dotfile symlinks;
- macOS defaults;
- the Fish login shell;
- AeroSpace, Borders, and Colima LaunchAgents;
- pinned language runtimes and command-line tools.

AeroSpace starts SketchyBar through `after-startup-command`, avoiding a service-order wrapper.

Three tapped Homebrew packages do not publish the API metadata required by mise's native package bootstrap. A small inline, missing-only task provisions the Homebrew CLI when necessary, then installs AeroSpace, SketchyBar, and Borders through Homebrew. This is the only bootstrap native-gap logic.

Docker Compose is mise-managed and exposed at `~/.docker/cli-plugins/docker-compose` so `docker compose` works without relying on Docker Desktop or Homebrew plugin discovery.

Dock ordering and login items are intentionally user-owned. Bootstrap also no longer refreshes running tmux sessions or preflights the work CA file; new processes consume the declared environment naturally.

## Validation

Run the non-destructive native checks and colocated tests:

```bash
mise run validate
```

The suite parses and plans both profiles, checks shell syntax, runs the Pi package suite, exercises tmux and work workflow tests, verifies the expected work security failure, runs Neovim in an isolated environment, and executes colocated macOS configuration tests. CI never runs a workstation bootstrap.

## Updates

Updates remain explicit and grouped:

```bash
mise --env personal-macos run update
mise --env work-macos run update
```

The task updates mise tools, refreshes the Docker Compose plugin link, updates Pi dependencies, the active profile's skills, Neovim plugins, native bootstrap packages, and tapped Homebrew packages. The work profile resolves TWG releases and cross-platform checksums from its upstream manifest, so TWG is updated through the same mise tool flow.

## Manual steps

Bootstrap deliberately leaves interactive authentication, privacy approvals, and application-owned startup preferences to the user.

### Before bootstrap

- Sign in to the Mac App Store. Both profiles install at least one App Store application with `mas`.

### All macOS profiles

- In **System Settings > Privacy & Security > Accessibility**, grant access to `/Applications/AeroSpace.app` and `/opt/homebrew/bin/borders` after bootstrap installs them.
- Sign in to Nextcloud and enable **Open on Login**.
- Sign in to Tailscale, enable **Open on Login**, and select **Show only in menu bar**.
- Authenticate GitHub and cloud CLIs, Pi providers, and MCP services as needed; their credentials are intentionally not stored in this repository.

Do not add AeroSpace to Login Items. Mise already starts AeroSpace and Borders at login with managed LaunchAgents.

### Work profile

- Confirm that corporate device management has installed the CA bundle referenced by the work profile:

  ```bash
  test -r "/Library/Application Support/DocuSign/zscaler-ca-bundle.pem"
  ```

- Authenticate TWG:

  ```bash
  twg auth setup
  ```

### Changing encrypted environment variables

Example command:

```bash
mise set -E personal-macos --age-encrypt --prompt SOME_API_KEY
```

Replace the profile and variable name as needed. The command uses `~/.config/mise/age.txt`, updates the profile's `[env]` table with ciphertext, and keeps the plaintext out of shell history. Review the resulting diff and validate the selected profile before committing:

```bash
git diff -- mise.personal-macos.toml
mise --env personal-macos run status
```

## Rollback and cutover

Revert the configuration commit and bootstrap the same explicit profile again:

```bash
git revert <commit>
MISE_ENV=personal-macos mise bootstrap
```
