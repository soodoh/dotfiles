# mise development environments

This repository is the canonical configuration for two explicit macOS profiles:

- `personal-macos`
- `work-macos`

The shared mise layer contains pinned runtimes, portable command-line tools, Neovim tooling, Fish configuration, Pi extensions, and common dotfiles. Profile files contain only identity, applications, credentials policy, skills, and agent differences.

> [!WARNING]
> mise machine bootstrap is experimental. This migration intentionally gives up atomic generations and immutable closures. Rollback is Git revert plus another bootstrap.

## Prerequisite

Install mise manually using the current [official installation instructions](https://mise.jdx.dev/getting-started.html). This repository does not install mise itself and has no default profile.

Clone the repository and trust its configuration:

```bash
git clone https://github.com/soodoh/dotfiles.git
cd dotfiles
mise trust
```

## Preflight and bootstrap

Always select one profile explicitly:

```bash
mise --env personal-macos run status
mise --env personal-macos bootstrap

# Or on the work Mac:
mise --env work-macos run status
mise --env work-macos bootstrap
```

The native bootstrap sequence installs missing packages, applies symlinked dotfiles and macOS defaults, installs locked tools, configures the login shell, and automatically runs `[tasks.bootstrap]` as its final reconciliation phase. That final task builds local npm packages and reconciles the Dock, login items, launch agents, and tmux.
Task auto-install is disabled, so `run status` and validation never provision missing tools as a side effect; the native bootstrap command owns installation.

Bootstrap is non-destructive:

- undeclared and MDM-installed applications are never removed;
- work Tailscale remains MDM-owned and is not installed or managed as a login item;
- normal bootstrap installs missing applications but does not broadly upgrade existing ones;
- existing Homebrew cask ownership is preserved; a missing-only reconciliation script installs casks that are not already present;
- conflicting unmanaged dotfiles are reported rather than replaced unless the operator explicitly chooses mise's force option.

No bootstrap was run against a live home directory while this repository replacement was implemented.

## Layout

- `mise.toml` — shared locked tools, packages, dotfiles, settings, tasks, and hooks
- `mise.personal-macos.toml`, `mise.work-macos.toml` — profile-only differences
- `mise*.lock` — exact tool resolution and checksums where supported
- `dotfiles/common/` — portable user configuration
- `dotfiles/darwin/` — macOS-only AeroSpace, SketchyBar, and Colima configuration
- `dotfiles/profiles/` — Git identity, Pi settings, workflows, and skill selection
- `pi-extensions/` — repository-local Pi package with a committed npm lockfile
- `packages/work-mcp-servers/` — repository-local work MCP closure
- `packages/google-calendar/` — tracked work launcher application
- `scripts/bootstrap/`, `scripts/update/`, `scripts/validate/` — mise-invoked reconciliation and checks
- `docs/migration-parity.md` — checked migration ledger
- `docs/cutover.md` — later manual workstation cutover and legacy-system removal

## Dotfiles and writable configuration

mise links all declared files directly into this checkout. Pi settings and saved workflows are intentionally writable symlinks, so Pi can modify tracked files at runtime. Review those changes with Git and either commit or revert them.
The profile Fish fragment resolves the checkout and points `MISE_GLOBAL_CONFIG_FILE` at its `mise.toml`, so the same locked tool layer remains active outside the repository without copying configuration.
Fish also activates the selected profile's tool environment, but bootstrap and update guards ignore that inherited value and still require an explicit `--env`/`-E` selector from the operator.

Local Fish secrets remain outside the repository:

```text
~/.config/fish/conf.d/00-secrets.fish
```

Keep that file mode `0600` and never commit credentials. Authenticate the App Store, GitHub, AWS/Azure/Google/Snowflake CLIs, Pi providers, and MCP services interactively. TWG setup and login remain manual.

## Neovim

Neovim uses one plugin manager: a commit-pinned lazy.nvim bootstrap with `lazy-lock.json`. Tree-sitter owns the declared parser set. LSP servers, linters, and formatters are locked mise tools; Mason is intentionally absent.

Clean validation copies the configuration into temporary HOME/XDG directories, synchronizes the lock, loads every plugin module and parser, and checks every configured external executable without modifying the checked-in lock.

## Pi and MCP servers

Pi is pinned through mise's npm backend. Bootstrap runs `npm ci` in `pi-extensions/`, verifies peer packages, aggregates bundled extension/skill/prompt resources, and validates the platform ReadSeek binary. macOS ReadSeek uses Homebrew `libgit2`; Linux uses the platform library package.

Work-only MCP servers are installed with `npm ci` under `packages/work-mcp-servers/`. The work environment adds that package's `node_modules/.bin` directory to PATH, and work MCP settings use those repository-local commands.

### Accepted work security exception

The work LiteLLM endpoint remains cleartext HTTP by explicit owner decision. Its test is an expected failure: validation confirms that the test still reports the known exception and must not present it as a passing security check. Revisit this when the endpoint supports TLS.

## Validation

Run the complete repository suite without applying workstation state:

```bash
mise run validate
```

Focused tasks are also available:

```text
validate:config
validate:tools
validate:dotfiles
validate:neovim
validate:agents
validate:macos
validate:repository
```

CI represents both Ubuntu and macOS. It parses both profiles, installs the locked shared portable layer, runs npm and profile tests, starts Neovim in a clean temporary environment, validates Fish and shell scripts, tests tmux and SketchyBar helpers, checks TWG metadata, and rejects stale runtime paths. CI does not run a real machine bootstrap, change a login shell or Dock, load workstation services, or install App Store applications.

## Updates

Updates are explicit and reviewable:

```bash
mise --env personal-macos run update:tools
mise --env personal-macos run update:agents
mise --env personal-macos run update:skills
mise --env personal-macos run update:neovim
mise --env personal-macos run update:apps
mise --env personal-macos run update:mas
mise --env personal-macos run update:twg
```

Use `work-macos` on the work profile. `update:apps` and `update:mas` are the only tasks intended to upgrade declared GUI/App Store applications. Nothing prunes undeclared software.

Renovate continues npm, GitHub Actions, and supported mise version updates. Pi dependency changes stay atomic and exact. Repository-specific generation for skills and TWG remains in the generated-dependencies workflow.

## Rollback

There is no atomic machine rollback. Revert the configuration commit, review the diff, and run the same explicit profile bootstrap again:

```bash
git revert <commit>
mise --env personal-macos bootstrap
```

Runtime or application data is not rolled back. Back up mutable configuration before major changes.

## Workstation cutover

Do not remove the previous machine manager first. Follow [`docs/cutover.md`](docs/cutover.md), verify the new Fish path and complete smoke tests, and only then perform the documented manual removal and reboot checks.
