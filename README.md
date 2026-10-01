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

- Install mise using the [official instructions](https://mise.jdx.dev/getting-started.html). The installer selects the newest stable release at least 24 hours old.

```bash
curl https://mise.run | sh
```

`min_version` in `mise.toml` is a compatibility floor, raised manually only when
required features or fixes change. It is not a CLI pin and Renovate does not
update it. The global `auto_update` setting keeps workstations current; both
that setting and unpinned `mise self-update` honor mise's release-age policy.
CI also uses mise-action's default selection of the newest stable release at
least 24 hours old. Tool versions and lockfiles remain pinned, but rerunning
a commit may use a newer mise CLI. Raise a minimum after the release cooldown
when possible; an explicit version install intentionally bypasses it.

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

The shared bootstrap links `dotfiles/common/mise/config.toml` as mise's global
config so bootstrap can use the existing host-specific `gh` login, including
tokens in the macOS Keychain. The credential command must be global: mise ignores
it in a local project config for security reasons.

Both Fish profiles set `MISE_CONFIG_DIR` to the checkout and select an explicit
`MISE_ENV`, making shared and profile tools available outside this repository.
They clear `MISE_GLOBAL_CONFIG_FILE` (including an inherited settings-only override)
and export `MISE_GITHUB_CREDENTIAL_COMMAND` with the same host-aware `gh` command.
This preserves authenticated downloads without replacing the global tool config.
Open a new Fish shell after updating to load these changes.

If a machine is already rate-limited **before** the global-config link exists,
install/authenticate `gh` first, then make the credentials config available for the
first retry (replace the profile as needed):

```bash
MISE_GLOBAL_CONFIG_FILE="$PWD/dotfiles/common/mise/config.toml" MISE_ENV=work-macos mise bootstrap
```

This is a recovery path for a machine with `gh` available, not an extra installer
or a requirement to create a new GitHub token. A fresh machine without `gh`
may need to wait for the unauthenticated rate limit to reset before the first
bootstrap can install it.

### Other Manual Steps

- Authenticate with Bitwarden desktop app & enable SSH agent. Then delete the temporary SSH keys we used to clone this repo initially: `rm ~/.ssh/id_ed25519*`
- In **System Settings > Privacy & Security > Accessibility**, grant access to:
    - Aerospace
    - Borders
    - Lunar
- Sign in to Nextcloud and enable **Open on Login**.
- Configure the Homebrew-formula Tailscale CLI:
    - Install the [Homebrew CLI](https://brew.sh) separately if absent; mise package bootstrap no longer installs it.
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
- Pair [Moshi hooks](https://getmoshi.app/docs/hooks) once per Mac:
    - mise installs the Homebrew formula; the shared `mise.toml` LaunchAgent runs it through `mise exec`, supplying mise's tool PATH without shell activation. Bootstrap registers and starts `dev.mise.moshi-hook`; do not also start the Homebrew service.
    - Copy the pairing token from **Settings > Hooks** in the Moshi app, then run the following locally (not over SSH):

      ```bash
      moshi-hook pair --token "$(pbpaste)"
      moshi-hook install
      moshi-hook status
      ```

    - If the running daemon does not pick up the new pairing, restart it with `launchctl kickstart -k "gui/$(id -u)/dev.mise.moshi-hook"`, then check `moshi-hook status` again. This is a troubleshooting restart, not a required service-start step after bootstrap.

### Manual steps for Work macOS

- In Zen/Firefox, open **Settings > Network Settings > Settings**, select **Automatic proxy configuration URL**, and enter `http://127.0.0.1:1056/cli-proxy.pac`. Click **Reload** and save.
- Authenticate TWG: `twg login`
- Create isolated Azure CLI profiles. Bare `az` and the read-only `azure-test` Pi MCP use the development profile; the read-only `azure` Pi MCP uses the production profile. Run these after bootstrap from a fresh work-profile shell so mise has decrypted `AZURE_DEV_TENANT_ID`, `AZURE_PROD_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`:

  ```bash
  mkdir -p ~/.azure/dev/.azure ~/.azure/prod/.azure

  AZURE_CONFIG_DIR="$HOME/.azure/dev/.azure" \
    az login --tenant "$AZURE_DEV_TENANT_ID"
  AZURE_CONFIG_DIR="$HOME/.azure/dev/.azure" \
    az account set --subscription "GitHub Billing - Builders and Partners"

  AZURE_CONFIG_DIR="$HOME/.azure/prod/.azure" \
    az login --tenant "$AZURE_PROD_TENANT_ID"
  AZURE_CONFIG_DIR="$HOME/.azure/prod/.azure" \
    az account set --subscription "$AZURE_SUBSCRIPTION_ID"
  ```

- Install ACM ([Agent Capability Manager CLI](https://github.docusignhq.com/FrontEndShared/agent-capabilities#installation)) on the work Mac, then explicitly install or refresh the 1DS plugin:

```bash
mise --env work-macos run update:acm
```

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
    - `/mcp login glean`
    - `/mcp login mixpanel`

- Install the self-updating internal `msf-cli` if it is not already present, then authenticate it as needed:

  ```bash
  curl -sSL https://artifactory.docusigntest.com/artifactory/github-releases-local/msf-cli/install.sh | zsh
  # Packages come from mise; ask MSF only to configure cluster access.
  msf-cli setup-workstation --step kubeconfig
  msf-cli login --resource keyvault --system-name ipg-engagements
  ```

## Validation

Run fast syntax, policy, and unit checks during normal iteration, or the full suite before merging:

```bash
mise run validate:fast
mise run validate:integration
mise run validate
```

## Updates

Updates remain explicit and grouped:

```bash
mise --env personal-macos run update
mise --env work-macos run update
```

After changing tools in any mise configuration, refresh every committed lockfile on Linux, the canonical CI platform:

```bash
mise run lock
```

## Changing encrypted environment variables

Ensure `~/.config/mise/age.txt` was setup, per the fresh install instructions.

The shared configuration sets `age.strict = false` so credential-free automation, including Renovate's lockfile generation outside GitHub Actions, skips undecryptable values. Both workstation Fish profiles export `MISE_AGE_STRICT=true`, preserving fail-fast decryption in configured shells. Open a new Fish shell after updating to load this policy. Outside those shells, use `MISE_AGE_STRICT=true mise …` when secrets must be available; without that override, missing or invalid identities do not stop mise. The age identity remains local and is never needed by CI or Renovate.

Example command:

```bash
mise set -E personal-macos --age-encrypt --prompt SOME_API_KEY
```
