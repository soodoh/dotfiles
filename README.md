# mise development environments

This repository is the canonical configuration for two explicit macOS profiles:

- `personal-macos`
- `work-macos`

The shared mise layer owns pinned runtimes, portable tools, common dotfiles, macOS defaults, packages, LaunchAgents, and lifecycle tasks. Each profile owns its identity, Pi configuration, complete agent skill catalog, applications, and credential policy.

## Fresh Install

### Setup required credentials

- Log into Apple account in System Settings (or at least App Store). This is needed for `mas`.

- Log into Bitwarden browser extension

- Copy mise age key from Bitwarden

```bash
mkdir -p ~/.config/mise
pbpaste > ~/.config/mise/age.text
chmod 600 ~/.config/mise/age.txt
```

- Temporarily copy SSH key from Bitwarden (remove after this repo is cloned, since we'll use Bitwarden desktop app's SSH agent going forward)

```bash
mkdir ~/.ssh
# Copy private key first
pbpaste > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
# Copy public key first
pbpaste > ~/.ssh/id_ed25519.pub
```

### Finish installation

- Install mise using the [official instructions](https://mise.jdx.dev/getting-started.html)

```bash
curl https://mise.run | sh
```

- Clone this repo

```bash
mkdir -p ~/Projects
git clone git@github.com:soodoh/dotfiles.git ~/Projects/dotfiles
cd ~/Projects/dotfiles
~/.local/bin/mise trust
```

- Copy the backed-up age identity file from Bitwarden, then save it with restricted permissions:

```bash
mkdir -p ~/.config/mise
pbpaste > ~/.config/mise/age.txt
chmod 600 ~/.config/mise/age.txt
```

- Run initial bootstrap command (with `MISE_ENV` set explicitly)

```bash
MISE_ENV=personal-macos mise bootstrap
# Or on the work Mac:
MISE_ENV=work-macos mise bootstrap
```

### Other Manual Steps

- Authenticate with Bitwarden desktop app & enable SSH agent. Then delete the temporary SSH keys we used to clone this repo initially: `rm ~/.ssh/id_ed25519*`
- In **System Settings > Privacy & Security > Accessibility**, grant access to:
    - Aerospace
    - Borders
    - Lunar
- Sign in to Nextcloud and enable **Open on Login**.
- Configure the Homebrew-managed Tailscale CLI:
    - Register and start its root launch daemon with `sudo brew services start tailscale`; launchd will start it automatically on future boots.
    - Authenticate once with `tailscale up` (add `--login-server=https://headscale.example.com` when using Headscale).
    - Enable Tailscale SSH with `tailscale set --ssh`.
- Open Amphetamine:
    - Launch Amphetamine at Login
    - Hide Amphetamine in the Dock
    - Allow display sleep
    - End session if battery is below 10%
- Authenticate with `gh` CLI: `gh auth login`
    - Where do you use GitHub? `GitHub.com`
    - What is your preferred protocol for Git operations on this host? `SSH`
    - Generate a new SSH key to add to your GitHub account? `No`
    - How would you like to authenticate GitHub CLI? `Login with a web browser`
- Open `pi` for the first time:
    - `/login openai-codex`
    - `/login openrouter`
- Authenticate `gws` CLI: `gws auth login`

### Manual steps for Work macOS

- Authenticate TWG: `twg login`
- Authenticate gcloud:

  ```bash
  gcloud auth application-default login

  # Use these values with `/login google-vertex` in Pi
  echo $GOOGLE_CLOUD_PROJECT
  echo $GOOGLE_CLOUD_LOCATION
  ```

- Open `pi` for the first time:
    - `/login google-vertex` (see previous step)
    - `/login github-copilot`
    - `/mcp-auth glean`
    - `/mcp-auth mixpanel`

- Install the self-updating internal `msf-cli` if it is not already present, then authenticate it as needed:

  ```bash
  curl -sSL https://artifactory.docusigntest.com/artifactory/github-releases-local/msf-cli/install.sh | zsh
  # Packages come from mise; ask MSF only to configure cluster access.
  msf-cli setup-workstation --step kubeconfig
  msf-cli login --resource keyvault --system-name ipg-engagements
  ```

## Validation

Run the non-destructive native checks and colocated tests:

```bash
mise run validate
```

The suite parses and plans both profiles, checks shell syntax, runs the Pi package suite, exercises tmux and work workflow tests, verifies the expected work security failure, runs Neovim in an isolated environment, and executes colocated macOS configuration tests. CI never runs a workstation bootstrap.

The work LiteLLM cleartext HTTP endpoint remains an intentional, exact expected failure. A follow-up must explicitly choose either HTTPS or a narrowly scoped private-network allowlist and update `AGENTS.md` with that policy; this validation change does neither.

## Updates

Updates remain explicit and grouped:

```bash
mise --env personal-macos run update
mise --env work-macos run update
```

After changing tools in any mise configuration, refresh every committed lockfile from either Mac:

```bash
mise run lock
```

This generates both explicit environments in isolated temporary roots, verifies that they produce the same shared `mise.lock`, and only then atomically publishes changed lockfiles. Mise writes profile-only tools to `mise.personal-macos.lock` or `mise.work-macos.lock`, so both environments cover all three committed locks without mutating the tracked configuration during generation.

The task updates mise tools, refreshes all shared and profile-specific mise lockfiles, refreshes the Docker Compose plugin link, updates Pi dependencies, the active profile's skills, Neovim plugins, native bootstrap packages, and tapped Homebrew packages. The work profile resolves TWG releases and cross-platform checksums from its upstream manifest, so TWG is updated through the same mise tool flow.

A weekly GitHub Actions workflow refreshes the repository-managed assets that Renovate does not cover: TWG metadata, both profile skill catalogs, and the Neovim plugin lock. It validates the resulting checkout and opens or refreshes a single update pull request when tracked files change.

## Changing encrypted environment variables

Ensure `~/.config/mise/age.txt` was setup, per the fresh install instructions.

Example command:

```bash
mise set -E personal-macos --age-encrypt --prompt SOME_API_KEY
```
