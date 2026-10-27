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
update it. The global `self_update.auto = true` setting keeps workstations current:
mise checks before eligible interactive commands, at most once every seven days
by default (not on shell activation or a background schedule). Both automatic
updates and unpinned `mise self-update` honor mise's release-age policy.
CI pins mise 2026.10.20, which fixes lock generation in locked configurations
(regressed in 2026.10.19). This explicit pin intentionally bypasses the release
cooldown and keeps validation and repository updates on the same CLI. Workstation
auto-updates still honor the release-age policy.

Google Cloud CLI uses mise's native HTTP backend with checksummed official SDK
archives, avoiding the bundled vfox plugin's Lua module-loading failure. It uses
the managed Python runtime without running Google's system-wide installer. The
repository-updates workflow maintains this HTTP tool alongside TWG; Renovate
continues to maintain supported tools and refresh all mise locks in safe mode.

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

- Apply the dotfiles with an explicit profile first, so native global credentials,
  work proxy/certificate settings, and the profile selector are available before
  bootstrap installs packages:

```bash
mise --env personal-macos dot apply --yes
# Or on the work Mac: mise --env work-macos dot apply --yes
cd ~
mise bootstrap
```

Global `miserc.toml` now selects the profile for plain `mise bootstrap`; no Fish
profile or `MISE_ENV` export is needed. `mise --env personal-macos bootstrap` (or
`work-macos`) also works when you want to select the profile explicitly.

Run bootstrap from outside this checkout (for example, `cd ~`) with mise
2026.10.20. When the same configuration is discovered both locally and through
its global folder link, mise can discard the local lockfile's download URLs and
report `No lockfile URL found` even though the committed entry is complete.
Global-only discovery avoids this upstream trust-resolution bug; keep locked mode
on and do not regenerate the locks to work around it.

On macOS, the pre-packages hook installs the pinned Ruby before inspecting
third-party casks. Cask inspection needs Ruby >= 3, but the normal tools phase
runs after packages; macOS's system Ruby is too old. For a read-only status/plan
check before the first bootstrap, run `mise install ruby` from outside the
checkout first.

The shared bootstrap links `dotfiles/common/mise/config.toml` as mise's global
config so bootstrap can use the existing host-specific `gh` login, including
tokens in the macOS Keychain. The credential command must be global: mise ignores
it in a local project config for security reasons.

Mise uses its standard `~/.config/mise` directory, without Fish-specific configuration
overrides. Shared bootstrap links this checkout as `conf.d/dotfiles`, plus the three
committed `mise*.lock` files beside global `config.toml`: folder fragments share the
enclosing global directory's lockfiles. Each explicit profile links its own
`dotfiles/{personal,work}/miserc.toml` as global `miserc.toml`, selecting
`personal-macos` or `work-macos` before config discovery. There is no default profile
in the checkout. `--env` can override the installed choice, including outside this
repository; project `.miserc.toml` files can override it too.

This makes shared/profile tools, automatic self-updates, and the host-aware GitHub
credential command available to Fish, other shells, and services alike. Task paths
use `vars.dotfiles_root`, resolved from the actual declaring file, so commands run
in the checkout whether it is discovered locally or through its global folder link.

Verify the installed global configuration with `mise settings get self_update.auto`
and `mise config ls` from outside the checkout.

### Updating an existing workstation

After pulling the credential-config split, install the new global links once from
this checkout (choose your profile):

```bash
mise --env personal-macos dot apply --yes
# Or: mise --env work-macos dot apply --yes
```

This applies declared dotfiles only, not packages, login shells, or services.
The encrypted values are unchanged, but they load only after these links exist.
Subsequent mise invocations use them automatically. Open a fresh shell to discard
any inherited settings from the old Fish profiles.

If a machine is already rate-limited, install/authenticate `gh` first. The native
global-config link installed by `mise dot apply` lets bootstrap reuse that login;
no `MISE_GLOBAL_CONFIG_FILE` override or new GitHub token is needed. A fresh machine
without `gh` may need to wait for the unauthenticated rate limit to reset before
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
    - `/mcp login gws-calendar`
    - `/mcp login gws-gmail`
    - `/mcp login gws-docs`
    - `/mcp login gws-sheets`

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

Encrypted environment values are workstation-only native global configuration:

| Source in this checkout | Installed global path |
| --- | --- |
| `dotfiles/common/mise/credentials.toml` | `~/.config/mise/conf.d/credentials.toml` |
| `dotfiles/personal/mise-credentials.toml` | `~/.config/mise/config.personal-macos.toml` |
| `dotfiles/work/mise-credentials.toml` | `~/.config/mise/config.work-macos.toml` |

Both profile files are linked, but mise loads only the selected profile's values.
The work file also owns its proxy and certificate environment. `age.strict = true`
remains enabled: installed workstations fail closed on missing or invalid identities,
inside and outside the checkout, without Fish exports. The separate global
`config.toml` remains settings-only and supplies the host-aware GitHub credential command.

A fresh dependency checkout does not load these workstation files. Renovate (trusted
or safe mode) and CI can generate locks without an age identity, decryption overrides,
or changes to Mend's runner. The repository lock helper also isolates staged generation
from workstation-global tools, profiles, and credential files. Never provide the age
identity to Renovate or CI.

Edit encrypted values in their source file, not the dependency manifests:

```bash
mise set --file dotfiles/personal/mise-credentials.toml --age-encrypt --prompt SOME_API_KEY
# For shared or work values, use the corresponding source path above.
```
