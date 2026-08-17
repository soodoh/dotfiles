# Manual workstation cutover

This procedure is intentionally separate from repository implementation. Do not run it until the migration diff is committed or safely stashed and reviewed.

## 1. Prepare and record state

1. Commit or stash every repository change.
2. Back up writable configuration, especially `~/.pi`, `~/.agents`, `~/.config`, `~/.gitconfig`, and `~/.colima`.
3. Record current packages, applications, Dock entries, login items, login shell, and services.
4. Confirm the selected profile: `personal-macos` or `work-macos`.
5. On work hardware, confirm `/Library/Application Support/DocuSign/zscaler-ca-bundle.pem` is readable.

## 2. Install and preflight mise

Install mise manually from its official instructions. From this repository:

```bash
mise trust
mise --env personal-macos run status
# or: mise --env work-macos run status
```

The status command is read-only. Review every missing/different item and resolve unexpected dotfile conflicts before applying anything.

The simplified profiles link `~/.agents` as one complete directory. After backing it up, remove the old directory containing per-skill links before the first bootstrap so mise can create the new whole-directory link:

```bash
rm -rf "$HOME/.agents"
```

### Transfer configured casks to mise ownership

mise intentionally refuses to adopt a cask that Homebrew already owns. During this one-time cutover, quit the configured GUI applications, list the casks that will be transferred, and uninstall only their Homebrew-owned app bundles. Do not use `--zap`; application data remains in the user Library for the mise-managed reinstall.

```bash
profile=personal-macos # or: work-macos
configured_casks=$(awk -F'"' '/"brew-cask:/{sub(/^brew-cask:/, "", $2); print $2}' mise.toml "mise.$profile.toml")
printf '%s\n' $configured_casks
for cask in $configured_casks; do
  if brew list --cask --versions "$cask" >/dev/null 2>&1; then
    brew uninstall --cask "$cask"
  fi
done
```

The following bootstrap reinstalls those app bundles under mise ownership. Third-party casks that mise cannot manage directly remain explicitly Homebrew-owned.

## 3. Bootstrap exactly one profile

```bash
mise --env personal-macos bootstrap
# or: mise --env work-macos bootstrap
```

Do not add a default profile or infer one from the username. Normal bootstrap installs missing applications but does not broadly upgrade existing applications or remove undeclared/MDM software.

## 4. Open a fresh terminal and smoke test

Verify, in order:

- Fish starts and `mise doctor` is healthy;
- `node`, `npm`, `python3`, `bun`, `go`, `rustc`, and profile-specific CLIs resolve;
- Neovim starts, plugins load, and configured LSP/formatter executables resolve;
- tmux starts and reloads the linked configuration;
- Pi starts, loads the checkout-local extension package, and can invoke ReadSeek;
- Docker/Compose can reach the Colima daemon;
- work MCP commands resolve from mise-managed npm tools;
- GUI applications, the Google Calendar app link, AeroSpace, SketchyBar, JankyBorders, and Colima behave as expected;
- manually configure and verify the desired Dock order, Downloads stack, and login items;
- the work Google Calendar launcher opens the expected URL;
- work certificate environment variables are present without changing MDM-owned `/etc/zshenv`.

Review `git status` afterward. Pi may intentionally have modified tracked settings or workflows.

## 5. Hard Fish-path gate

Before uninstalling Nix, the account login shell must no longer be the Nix-managed Fish path. This is a hard prerequisite: removing Nix first can leave the account unable to start its login shell.

```bash
dscl . -read "/Users/$USER" UserShell
```

Expected result:

```text
UserShell: /opt/homebrew/bin/fish
```

Do **not** continue if the result is `/run/current-system/sw/bin/fish`, another path under `/nix`, empty, or unexpected. Repair the shell first, open a new terminal, and repeat the smoke tests.

## 6. Later manual Nix uninstall

Only after all previous checks pass should Nix be removed. This repository does not automate that destructive step.

Use the current official [Nix uninstall instructions](https://nix.dev/manual/nix/latest/installation/uninstall) for a multi-user macOS installation. Read the instructions completely before executing them. They cover:

- restoring or editing system shell initialization files;
- unloading and removing daemon launch services;
- removing build users and their group;
- removing the store mount from `fstab`;
- removing the `nix` entry from `/etc/synthetic.conf`;
- removing user/system profile state;
- deleting the APFS Nix Store volume.

Back up files before editing them, inspect each command for the current machine, and do not touch MDM-owned `/etc/zshenv`.

## 7. Reboot and repeat smoke tests

After manual uninstall:

1. Reboot.
2. Confirm the login shell is `/opt/homebrew/bin/fish`.
3. Repeat the Fish, mise, Neovim, tmux, Pi, Docker, CLI, GUI, user-owned Dock/login-item, and service checks.
4. Run the selected profile's status command and repository validation.
5. Review `git status` and keep or revert intentional runtime changes.

## Rollback during cutover

If the new configuration is wrong but the old manager is still installed, revert the repository commit and re-run the explicit mise bootstrap. There is no atomic generation rollback. If Nix has already been removed, restore from backups, fix the repository, and re-bootstrap; reinstalling the old manager is a separate manual recovery decision.
