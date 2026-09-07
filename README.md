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
- Pair [Moshi hooks](https://getmoshi.app/docs/hooks) once per Mac:
    - Homebrew installs the binary; the shared `mise.toml` LaunchAgent runs it through `mise exec`, supplying mise's tool PATH without shell activation. Bootstrap registers and starts `dev.mise.moshi-hook`; do not also start the Homebrew service.
    - Copy the pairing token from **Settings > Hooks** in the Moshi app, then run the following locally (not over SSH):

      ```bash
      moshi-hook pair --token "$(pbpaste)"
      moshi-hook install
      moshi-hook status
      ```

    - If the running daemon does not pick up the new pairing, restart it with `launchctl kickstart -k "gui/$(id -u)/dev.mise.moshi-hook"`, then check `moshi-hook status` again. This is a troubleshooting restart, not a required service-start step after bootstrap.

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

The suite parses and plans both profiles, checks shell syntax, runs the Pi package suite, exercises isolated Fish autostart and Herdr integration tests, validates the Herdr config natively, verifies the expected work security failure, runs Neovim in an isolated environment, and executes colocated macOS configuration tests. CI never runs a workstation bootstrap.

CI restores tools explicitly and always runs `mise install --locked` and the full validation suite, including on exact cache hits. Successful PR and main jobs save misses and compatible fallback generations. `.github/workflows/mise-cache-key.py` keys the shared CI tool declarations, task tools, install options, and current-platform lock state—not profile-only tools, task descriptions, or ordinary environment values. OS, architecture, runner image family, mise version, and installation policy bound fallback reuse; new options invalidate the whole boundary. A cached fingerprint manifest forces reinstallation of new or replaced lock artifacts, including same-version changes, while retaining unchanged installs. Review the projection and bump its schema when changing installation/provenance policy or introducing environment-dependent tool inputs. Neither the manifest nor locked installation is an integrity scan of cached executable contents.

The tool archive retains mise's data directory and CI-owned Cargo proxies. Rustup lives inside mise's data directory, so Rust symlinks and their toolchains travel together without archiving runner-preinstalled toolchains. Mise configuration, credentials, Cargo registries, and unrelated HOME state are excluded. Neovim archives only the active validation namespace, keyed by the actual Neovim version, OS/architecture, plugin lock, parser list, and runner image family; there is no cross-namespace fallback. Plugin restore, parser/executable assertions, and copied-lock checks still execute. Main cannot reuse PR merge-ref caches, so successful main runs must seed their own generations. No cache cleanup or retention automation is configured here.

`mise run validate:agents` also validates resources declared in `pi-extensions/package.json` and loads each extension, then the combined manifest, through the actual mise-managed Pi loader. These checks use mise's Node LTS in temporary, credential-free processes with subprocesses, native addons, and external writes denied; no extension exception list is maintained. Network access is not blocked: `PI_OFFLINE` is best-effort, and the checks do not start sessions, invoke tools, or prompt models. They cover imports, factory registration, resource diagnostics, and registration conflicts—not session lifecycle, tool execution, or native background completion, which still needs a manual smoke test after relevant upgrades.

The work LiteLLM cleartext HTTP endpoint remains an intentional, exact expected failure, checked against enabled Pi model providers. A follow-up must explicitly choose either HTTPS or a narrowly scoped private-network allowlist and update `AGENTS.md` with that policy; this validation change does neither.

## Herdr terminal workspaces

Both profiles use Herdr 0.8.2 in interactive Fish shells, with Tokyo Night and
native workspace/agent navigation. Only `~/.config/herdr/config.toml` is linked
into Git; session snapshots, sockets, plugins, and history remain local.
`ha` launches/attaches Herdr; prefix **Ctrl+Space**, then **d**, detaches back to
Fish. Existing tmux panes and editor terminals are excluded from autostart.

The locally maintained [`pi-extensions/packages/agent-state`](pi-extensions/packages/agent-state/README.md)
is enabled by both profile filters. One state owner combines parent lifecycle,
native prompts, subagent work and pending completion delivery, then reports to
Herdr and Moshi. Moshi also works outside Herdr; neither adapter treats the parent
yielding to children as task completion. An ownership-safe adapter uses upstream's
versioned host-liveness protocol without patching pi-subagents. Only the parent's
native prompts request human attention; legacy blocker events are ignored. Both
generated standalone hooks are excluded without deleting them.
Reconcile with `bun install --cwd pi-extensions --frozen-lockfile`, then `/reload`;
no bootstrap, daemon update or pairing change is needed. See the package README
for protocol tests, upstream attribution and manual notification acceptance.
Pi now uses its regular rendering default. `pi --tui-mode fullscreen` remains a
per-launch rendering fallback; the state reporter does not alter Pi rendering.

See [Herdr migration and acceptance](dotfiles/common/herdr/README.md) for the
keymap, accepted differences, outstanding GUI/SSH checks, and safe rollback.
Alerter is included in the macOS-only Homebrew bootstrap/update tasks.
`bootstrap:herdr-plugins` reconciles Sesh (Linux/macOS) and
`herdr-focus-notify` (macOS only) to their exact committed pins, installing missing
plugins and applying changed pins to healthy managed installations.
`update:herdr-plugins` has the same behavior. Both refuse to replace/re-enable
disabled or modified installations. Applying a changed pin executes upstream build
code and can upgrade or roll back a plugin; matching pins are no-ops. **Alt+E** opens Sesh; mise also supplies its `eza`
preview dependency alongside the existing zoxide and fzf. See
[plugin provisioning](dotfiles/common/herdr/README.md#notification-plugin-provisioning)
for prerequisites, notification-delivery policy and routing limitations.

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

This generates both explicit environments in isolated temporary roots, verifies that they produce the same shared `mise.lock`, and only then atomically publishes changed lockfiles. Mise writes profile-only tools to `mise.personal-macos.lock` or `mise.work-macos.lock`, so both environments cover all three committed locks without mutating the tracked configuration during generation.

The task updates mise tools, refreshes all shared and profile-specific mise lockfiles, refreshes the Docker Compose plugin link, updates Pi dependencies, the active profile's skills, Neovim plugins, native bootstrap packages, tapped Homebrew packages, and applies committed Herdr plugin pins. The work profile resolves TWG releases and cross-platform checksums from its upstream manifest, so TWG is updated through the same mise tool flow.

After updating Moshi or mise-managed tools used by the daemon, run `launchctl kickstart -k "gui/$(id -u)/dev.mise.moshi-hook"` on paired Macs. Bootstrap skips already-loaded agents whose plist is unchanged; updating a binary or tool version does not change this agent's declaration. Restarting refreshes the running binary and mise environment; no need to pair or install hooks again.

A weekly GitHub Actions workflow refreshes the repository-managed assets that Renovate does not cover: TWG metadata, both profile skill catalogs, the Neovim plugin lock, and Herdr plugin commit pins. It runs configuration/lock validation and opens or refreshes a single update pull request when tracked files change. Herdr pin refresh resolves upstream main without building or executing plugin code. Review the upstream changes before merging; after pulling, run `MISE_ENV=<profile> mise bootstrap` to apply the committed pins, or use `mise --env <profile> run update:herdr-plugins` for plugins only. Neither plugin reconciliation task resolves newer upstream versions.

### Matt Pocock skills

Both `dotfiles/personal/agents/` and `dotfiles/work/agents/` include the 25 published engineering and productivity skills from [mattpocock/skills](https://github.com/mattpocock/skills), with their reference files, templates, and `.skill-lock.json` entries. The initial full-set import matches upstream commit `3cca18b368ae95cdbdebbff572ccafa662551015`; `in-progress/` and `misc/` skills are excluded. Keep the vendored files unchanged so normal skill updates remain straightforward.

In a new Pi session, invoke `/skill:ask-matt` for workflow selection or `/skill:wayfinder` for multi-session planning. Upstream's `/name` commands are `/skill:name` in Pi. When upstream says to "Call the Skill tool", instruct Pi to read and follow the named skill's `SKILL.md` using its available file-reading tool; Pi does not expose that native tool. Follow Pi's existing delegation rules for subagent work. This is prompt-level compatibility guidance, not an installed runtime adapter.

Installing the catalog does not configure a project's issue tracker or create project docs. Run `/skill:setup-matt-pocock-skills` separately in a target repository when needed; notably, unmodified `code-review` expects `docs/agents/issue-tracker.md`. Review each workflow before invoking it: `to-spec` publishes to the configured tracker and `implement` ends by committing.

The existing update tasks refresh installed skills, not newly published or renamed ones. Reconcile those explicitly with the pinned `vars.skills_cli_version`, selecting only the intended skills. For repository-only installs, use temporary homes whose `.agents` links point to each profile catalog; never repoint the workstation's live `~/.agents` link. Preserve unrelated skills and lock metadata, and review both profile diffs.

## Changing encrypted environment variables

Ensure `~/.config/mise/age.txt` was setup, per the fresh install instructions.

The shared configuration sets `age.strict = false` so credential-free automation, including Renovate's lockfile generation outside GitHub Actions, skips undecryptable values. Both workstation Fish profiles export `MISE_AGE_STRICT=true`, preserving fail-fast decryption in configured shells. Open a new Fish shell after updating to load this policy. Outside those shells, use `MISE_AGE_STRICT=true mise …` when secrets must be available; without that override, missing or invalid identities do not stop mise. The age identity remains local and is never needed by CI or Renovate.

Example command:

```bash
mise set -E personal-macos --age-encrypt --prompt SOME_API_KEY
```
