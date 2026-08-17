# Nix-to-mise parity ledger

This ledger is the deletion gate for the mise migration. Every behavior formerly declared through Nix, nix-darwin, or Home Manager is mapped to one of these outcomes:

1. **Native mise tool** — versioned tool backend in `mise*.toml`
2. **Mise bootstrap package** — `[bootstrap.packages]`
3. **Mise dotfile** — `[dotfiles]` symlink into this checkout
4. **Mise macOS setting** — native bootstrap macOS declaration
5. **Mise task/hook** — idempotent repository script invoked only by mise
6. **Intentionally dropped** — accepted tradeoff, with rationale

The profile names are `personal-macos` and `work-macos`. The common layer is portable to macOS and Linux; macOS-only rows are skipped or validated without mutation on Linux.

## Configuration, profiles, and lifecycle

| Existing behavior | Source | Class | Destination / tradeoff |
|---|---|---:|---|
| One shared user layer plus personal/work overlays | `flake.nix`, `nix/modules/common`, `nix/modules/profiles` | 1–5 | `mise.toml` plus `mise.personal-macos.toml` or `mise.work-macos.toml` |
| Explicit host/profile selection | host records and switch scripts | 5 | `scripts/bootstrap/require-profile.sh`; bootstrap aborts unless the explicit CLI environment is exactly `personal-macos` or `work-macos` |
| Username inference/default personal host | `bootstrap/nix-macos.sh` | 6 | Dropped by decision; there is no default profile or username inference |
| Nix installer/bootstrap | `bootstrap/nix-macos.sh` | 6 | Dropped; mise is a documented manual prerequisite |
| Nix generation rollback and atomic closures | Nix | 6 | Accepted loss; rollback is Git revert plus explicit re-bootstrap |
| Store immutability and full provenance audit | Nix | 6 | Accepted loss; npm/mise locks and checksums retain critical-tool provenance only |
| Pinned Homebrew tap snapshots | `flake.lock`, `homebrew.nix` | 6 | Accepted loss; GUI casks follow current metadata |
| Non-destructive convergence | activation modules | 1–5 | mise install/apply semantics plus scripts that add/reconcile only; no prune/remove paths |
| Status/audit without mutation | `bin/nix-audit` | 5 | `mise run status` / `scripts/validate/status.sh` report missing and external state |
| Normal apply upgrades declared casks | `homebrew.onActivation.upgrade = true` | 6 | Intentionally changed by decision: normal bootstrap installs/reconciles but does not upgrade existing apps |
| Explicit updates | `bin/nix-update` | 5 | `update`, `update:tools`, `update:agents`, `update:neovim`, `update:apps`, `update:mas`, `update:twg` |

## Portable runtimes and common command-line tools

Pinned versions below preserve the evaluated pre-migration package set where a reliable mise backend exists. Exact pins may be advanced only through explicit update tasks and Renovate.

| Tool / behavior | Pre-migration version | Class | Backend / destination |
|---|---:|---:|---|
| Node.js | 24.18.1 | 1 | core `node` |
| npm/Corepack | npm 12.0.2 / Corepack 0.35.0 | 1, 5 | Node distribution plus package-manager pin and bootstrap validation |
| Python | 3.14.6 | 1 | core `python` |
| Bun | 1.3.13 | 1 | core `bun` |
| Go | 1.26.5 | 1 | core `go` |
| Rust, Cargo, Clippy, rustfmt, rust-src | 1.97.1 | 1, 5 | core `rust`; post-install/bootstrap component reconciliation; `RUST_SRC_PATH` derived from active toolchain |
| uv | 0.12.1 | 1 | registry/aqua backend |
| GitHub CLI | 2.97.0 | 1 | aqua `cli/cli` |
| jq | 1.8.2 | 1 | aqua `jqlang/jq` |
| ripgrep | 15.2.0 | 1 | aqua `BurntSushi/ripgrep` |
| fzf | 0.74.2 | 1 | aqua `junegunn/fzf` |
| Atuin | 18.18.1 | 1 | aqua/GitHub `atuinsh/atuin` |
| Lazygit | 0.64.0 | 1 | aqua `jesseduffield/lazygit` |
| Starship | 1.26.0 | 1 | aqua `starship/starship` |
| Zoxide | 0.10.0 | 1 | aqua `ajeetdsouza/zoxide` |
| Sesh | 2.28.0 | 1 | aqua/GitHub `joshmedeski/sesh` |
| Yazi | 26.5.6 | 1 | aqua/GitHub `sxyazi/yazi` |
| Neovim | 0.12.4 | 1 | aqua/GitHub `neovim/neovim` |
| Tree-sitter CLI | 0.26.9 | 1 | npm/cargo backend |
| tmux | 3.7b | 2 | Homebrew on macOS; apt package on Linux CI/common bootstrap where available |
| Fish | 4.8.1 | 2 | Homebrew on macOS; platform package on Linux |
| GnuPG | 2.4.9 | 2 | Homebrew/apt native package |
| wget | 1.25.0 | 2 | Homebrew/apt native package |
| trash CLI | current | 2 | Homebrew formula `trash` on macOS; compatible package when available on Linux |
| Git | 2.55.0 | 2 | platform package manager; system Git remains a valid existing provider |
| `EDITOR`, `VISUAL`, locale, `GPG_TTY` | Fish init | 3 | linked Fish config |

## Profile-only tools

| Tool / behavior | Profile | Version | Class | Backend / destination |
|---|---|---:|---:|---|
| AWS CLI v2 | personal | 2.35.11 | 1 | aqua/GitHub backend |
| Playwright MCP | both | 0.0.76 | 1 | npm backend |
| Azure CLI | work | 2.89.0 | 1 | pipx/ubi where reliable; Homebrew fallback documented in feasibility table |
| Azure MCP | work | 3.0.0-beta.10 | 1 | npm backend |
| Google Cloud CLI | work | 570.0.0 | 2 | Homebrew cask/formula because native SDK packaging is platform-integrated |
| Snowflake CLI | work | current cask | 2 | vendor Homebrew tap/cask reconciliation; preserve app-bundle PATH |
| TWG | work | 1.1.1 | 1 | mise HTTP backend with four platform URLs and SHA-256 checksums |
| Work MCP server package | work | lockfile | 5 | `npm ci` in `packages/work-mcp-servers`; commands from `node_modules/.bin` |
| Corepack availability | work/common npm builds | 0.35.0 | 1, 5 | Node toolchain/bootstrap check |

## Neovim plugins

All plugins move to lazy.nvim specifications under `dotfiles/common/.config/nvim/lua/plugins`. `lazy-lock.json` is committed. The three explicitly custom revisions remain exact; every other plugin is locked to the commit resolved during migration.

| Plugin | Class | Lazy source / constraint |
|---|---:|---|
| Comment.nvim | 3 | `numToStr/Comment.nvim` |
| alpha-nvim | 3 | `goolord/alpha-nvim` |
| blink.cmp | 3 | `saghen/blink.cmp` |
| bufferline.nvim | 3 | `akinsho/bufferline.nvim` |
| conform.nvim | 3 | `stevearc/conform.nvim` |
| diffview.nvim | 3 | `sindrets/diffview.nvim` |
| fidget.nvim | 3 | `j-hui/fidget.nvim` |
| flash.nvim | 3 | `folke/flash.nvim` |
| friendly-snippets | 3 | `rafamadriz/friendly-snippets` |
| git-conflict.nvim | 3 | `akinsho/git-conflict.nvim`, preserve current version constraint |
| gitlinker.nvim | 3 | `linrongbin16/gitlinker.nvim` at `a1b74070bbd5e50128190c85b09f1431ea5fbd83` |
| gitsigns.nvim | 3 | `lewis6991/gitsigns.nvim` |
| harpoon | 3 | `ThePrimeagen/harpoon`, branch `harpoon2` |
| indent-blankline.nvim | 3 | `lukas-reineke/indent-blankline.nvim` |
| lspsaga.nvim | 3 | `nvimdev/lspsaga.nvim` |
| lualine.nvim | 3 | `nvim-lualine/lualine.nvim` |
| nvim-colorizer.lua | 3 | `catgoose/nvim-colorizer.lua` |
| nvim-lspconfig | 3 | `neovim/nvim-lspconfig` |
| nvim-surround | 3 | `kylechui/nvim-surround` |
| nvim-treesitter | 3 | `nvim-treesitter/nvim-treesitter`; parser installs are the only mutable parser mechanism |
| nvim-ts-autotag | 3 | `windwp/nvim-ts-autotag` |
| nvim-ufo | 3 | `kevinhwang91/nvim-ufo` |
| nvim-web-devicons | 3 | `nvim-tree/nvim-web-devicons` |
| plenary.nvim | 3 | `nvim-lua/plenary.nvim` |
| promise-async | 3 | `kevinhwang91/promise-async` |
| rainbow-delimiters.nvim | 3 | `HiPhish/rainbow-delimiters.nvim` |
| snacks.nvim | 3 | `folke/snacks.nvim` |
| telescope-fzf-native.nvim | 3 | `nvim-telescope/telescope-fzf-native.nvim` with build command |
| telescope-live-grep-raw.nvim | 3 | `nvim-telescope/telescope-live-grep-raw.nvim` at `53e9df55b3651dd7cf77e172f1e8c9a17407acca` |
| telescope.nvim | 3 | `nvim-telescope/telescope.nvim` |
| tokyonight.nvim | 3 | `folke/tokyonight.nvim` |
| trouble.nvim | 3 | `folke/trouble.nvim` |
| vim-rzip | 3 | `lbrayner/vim-rzip` at `f65400fed27b27c7cff7ef8d428c4e5ff749bf28` |
| which-key.nvim | 3 | `folke/which-key.nvim` |
| yazi.nvim | 3 | `mikavilpas/yazi.nvim` |
| blink-cmp-avante | 3 | `Kaiser-Yang/blink-cmp-avante` |
| blink-nerdfont.nvim | 3 | `MahanRahmati/blink-nerdfont.nvim` |
| blink-emoji.nvim | 3 | `moyiz/blink-emoji.nvim` |
| pi.nvim | 3 | `pablopunk/pi.nvim` |
| blink-cmp-git | 6 | Intentionally not added; its source is commented out today |
| `nix-plugin-loader.lua` | 6 | Removed; lazy.nvim becomes the sole plugin manager |

### Tree-sitter parsers

Class 3 via the pinned nvim-treesitter specification and its `ensure_installed` list: `bash`, `c`, `css`, `diff`, `dockerfile`, `git_config`, `git_rebase`, `gitignore`, `go`, `gomod`, `gosum`, `graphql`, `html`, `javascript`, `jsdoc`, `json`, `jsonc`, `kdl`, `lua`, `luadoc`, `markdown`, `markdown_inline`, `nix`, `prisma`, `python`, `regex`, `rust`, `toml`, `tsx`, `typescript`, `vim`, `vimdoc`, and `yaml`.

### LSPs, formatters, and linters

| Executable/package | Current use | Class | Mise source policy |
|---|---|---:|---|
| awk-language-server | `awk_ls` | 1 | npm |
| bash-language-server | `bashls` | 1 | npm |
| biome | LSP/formatter | 1 | npm/aqua pin |
| docker-language-server | LSP | 1 | npm/GitHub pin |
| gopls | LSP | 1 | go backend |
| graphql-language-service-cli | LSP | 1 | npm |
| lua-language-server | LSP | 1 | aqua/GitHub |
| marksman | LSP | 1 | aqua/GitHub |
| oxlint | LSP/linter | 1 | npm |
| prisma-language-server | installed, inactive | 1 | npm; retained for inventory parity |
| pyright | LSP | 1 | npm |
| ruff | LSP/formatter | 1 | aqua/ubi |
| rust-analyzer | LSP | 1 | Rust toolchain component |
| taplo | LSP | 1 | cargo/aqua |
| typescript-language-server | LSP | 1 | npm |
| vim-language-server | LSP | 1 | npm |
| vscode-langservers-extracted | CSS/HTML/JSON/ESLint LSPs | 1 | npm |
| yaml-language-server | LSP | 1 | npm |
| eslint_d | installed, inactive | 1 | npm; retained for inventory parity |
| kdlfmt | formatter | 1 | cargo |
| prettier | formatter | 1 | npm |
| shellcheck | formatter validation/lint | 1 | aqua |
| shfmt | formatter | 1 | aqua |
| stylua | formatter | 1 | cargo/aqua |
| yamllint | installed, inactive | 1 | pipx |
| csharp_ls | configured but disabled/unprovided | 6 | Intentionally not installed; preserve disabled state |
| Mason | absent | 6 | Remains absent; mise owns external tools |

## Fish and linked dotfiles

| Destination / behavior | Class | Source / reconciliation |
|---|---:|---|
| `~/.config/atuin` | 3 | `dotfiles/common/.config/atuin` |
| `~/.config/fish` including custom files and both vendored plugins | 3 | `dotfiles/common/.config/fish` |
| `~/.config/ghostty` | 3 | `dotfiles/common/.config/ghostty` |
| `~/.config/.gitignore_global` | 3 | `dotfiles/common/.config/.gitignore_global` |
| `~/.gitconfig` identity/default branch/global ignore | 3 | profile-specific tracked file |
| `~/.config/lazygit` | 3 | `dotfiles/common/.config/lazygit` |
| `~/.config/nvim` | 3 | `dotfiles/common/.config/nvim` |
| `~/.config/sesh` | 3 | `dotfiles/common/.config/sesh` |
| `~/.config/starship.toml` | 3 | tracked file |
| `~/.config/tmux` | 3 | `dotfiles/common/.config/tmux` |
| `~/.config/yazi` | 3 | `dotfiles/common/.config/yazi` |
| Starship/Zoxide/Atuin/fzf Fish activation and vi bindings | 3 | `dotfiles/common/.config/fish/config.fish` |
| Git plugin abbreviations and abbreviation-tips | 3 | vendored plugin directories linked with Fish config |
| tmux auto-attach/create `main` with VS Code/Zed guards | 3 | Fish config |
| Refresh running tmux PATH/default shell/config after bootstrap | 5 | idempotent post-dotfiles task |
| Local Fish secrets | 6 | Intentionally unmanaged at `~/.config/fish/conf.d/00-secrets.fish` |

## Pi, agents, skills, workflows, and MCP

| Behavior | Class | Destination |
|---|---:|---|
| Pi coding agent | 1 | npm backend pinned to `@earendil-works/pi-coding-agent@0.84.2`; align peers with extension dev pins |
| Local Pi extension package and five local extensions | 3, 5 | checkout-local `pi-extensions`; `npm ci`; profile settings point directly into checkout |
| Ten bundled third-party Pi dependencies/resources | 5 | committed `scripts/bootstrap/pi-extensions.mjs` aggregates dependency `pi.{extensions,skills,prompts,themes}` into a generated checkout-local manifest |
| Pi peer packages | 5 | npm install/validation ensures agent-core, ai, coding-agent, and tui resolve from local package context |
| ReadSeek macOS native binary | 2, 5 | `brew:libgit2`; validate `otool` dependency and execution; no binary rewriting when expected Homebrew path is present |
| ReadSeek Linux native binary | 2, 5 | platform libgit2/zlib packages plus execution smoke test |
| Writable Pi settings/workflows | 3 | direct symlinks into the checkout; Pi may dirty tracked files by design |
| Shared/profile Pi whole-file precedence | 3 | explicit profile mapping in each environment file; no JSON merge |
| `~/.agents` personal subset | 3 | explicit symlinks for seven selected skills plus filtered lock generated by task |
| `~/.agents` work full catalog | 3 | symlink full catalog and lock |
| Work saved `review-loop` workflow | 3 | direct symlink to work profile saved tree |
| Work LiteLLM HTTP exception | 3, 5 | retained in work model config; security test remains an expected failure |
| Context7 remote MCP | 3 | both profile MCP files |
| Playwright MCP | 1, 3 | pinned npm tool; both profile MCP files |
| Mixpanel and Glean OAuth remotes | 3 | work MCP file |
| Azure MCP | 1, 3 | pinned npm tool; `azure-mcp server start` |
| Azure DevOps, Kusto, and Figma MCP | 5, 3 | `packages/work-mcp-servers/node_modules/.bin` launchers |
| Personal skill subset vs full work catalog | 3, 5 | explicit profile dotfile entries plus generated filtered lock validation |

## macOS applications

Casks use current releases by decision. Bootstrap package apply installs only missing entries; upgrades occur only via `update:apps` or `update:mas`.

| Application/tool | Profile | Class | Source / policy |
|---|---|---:|---|
| Ghostty | both | 2 | Homebrew cask |
| Obsidian | both | 2 | Homebrew cask |
| Lunar | both | 2 | Homebrew cask |
| Nextcloud | both | 2 | Homebrew cask |
| Wispr Flow | both | 2 | Homebrew cask |
| Zen | both | 2 | Homebrew cask |
| Discord | personal | 2 | Homebrew cask |
| Anki | personal | 2 | Homebrew cask |
| Moonlight | personal | 2 | Homebrew cask |
| RAR | personal | 2 | Homebrew formula/cask as supported |
| Google Chrome | personal | 2 | Homebrew cask |
| Slack | personal | 2 | Homebrew cask |
| Zoom | personal | 2 | Homebrew cask |
| PrusaSlicer | personal | 2 | Homebrew cask |
| Google Calendar launcher | work | 5 | tracked `.app` built/copied by an idempotent task |
| Snowflake CLI | work | 2 | vendor tap cask |
| Work Tailscale | work | 6 | MDM-owned; excluded from installation and login-item management |
| Work Chrome, Slack, Privileges | work | 6 | Externally/MDM-owned; status reports missing paths but never installs/removes them |
| Tailscale | personal | 2 | MAS ID `1475387142` |
| Amphetamine | both | 2 | MAS ID `937984704` |
| HP Smart | personal | 2 | MAS ID `1474276998` |
| Fira Code Nerd Font | both | 2 | Homebrew font cask |
| MAS broad upgrade | all | 6 | Never implicit; only declared IDs upgrade through `update:mas` |

## macOS system behavior

| Behavior | Class | Destination |
|---|---:|---|
| Fish registered and selected as login shell | 2, 5 | install via bootstrap package; task adds canonical Homebrew Fish to `/etc/shells` and changes only the selected account shell |
| Dock order per profile | 5 | non-destructive `scripts/bootstrap/macos/dock.sh`; add/reorder desired entries and Downloads stack, never remove unrelated applications |
| Dock `show-recents=false` | 4 | native mise macOS Dock setting |
| Downloads stack | 5 | Dock task |
| Window drag gesture | 4 | raw `NSGlobalDomain.NSWindowShouldDragOnGesture=true` |
| Lunar and Nextcloud login items | 5 | additive AppleScript reconciliation |
| Personal Tailscale login item | 5 | personal-only additive reconciliation |
| AeroSpace config/startup | 2, 3, 5 | cask/package, linked config, launch agent task |
| SketchyBar config/startup after AeroSpace | 2, 3, 5 | formula, linked config, launch agent that waits for AeroSpace |
| JankyBorders colors/width/logs | 2, 5 | formula and launch agent task |
| Colima 4 CPU / 8 GiB / 100 GiB / arm64 / Docker / VZ / Rosetta / VirtioFS / inotify | 2, 3, 5 | packages, tracked Colima profile, launch agent |
| Explicit `colima stop` persists until next login | 5 | launch agent has no successful-exit KeepAlive; starts only at login/load |
| Lima, Docker CLI, Compose | 2 | Homebrew formulae |
| Work CA variables | 3, 5 | work environment file and preflight readability check |
| `/etc/zshenv` corporate ownership | 6 | Intentionally untouched |
| Nix cache, GC, optimize, PAM, state versions | 6 | Nix-specific and intentionally dropped |

## Validation, CI, and updates

| Behavior | Class | Destination |
|---|---:|---|
| Config parsing for both explicit profiles | 5 | `validate:config`; CI macOS and Ubuntu |
| Locked portable tool metadata | 1, 5 | `mise*.lock`, `tool_config.locked`, validation |
| Root npm lock and `npm ci` | 5 | `validate:agents`/CI |
| Pi extension full CI | 5 | `npm ci` + `npm run ci` |
| Work MCP lock/install | 5 | `npm ci` and binary checks |
| Neovim clean-environment smoke | 5 | temporary HOME/XDG cache/data; lazy sync/parser install/module/executable/Nix-path checks |
| Fish and shell syntax | 5 | Fish parser, `bash -n`/ShellCheck |
| tmux tests | 5 | existing Node tests |
| SketchyBar tests | 5 | existing shell tests |
| Profile-specific Pi tests | 5 | work saved-workflow suite plus explicit expected-failure security test |
| TWG metadata/checksums | 5 | checksum fixture validation and safe HTTP backend config check |
| Stale runtime path guard | 5 | repository-wide active-source check |
| Git whitespace validation | 5 | `git diff --check` |
| Generated skill updates | 5 | generated-dependencies workflow uses pinned Skills CLI and explicit update task |
| Renovate Nix managers | 6 | Removed |
| Renovate npm/GitHub Actions/Pi atomic group | 5 | retained and rewritten for mise/lazy/TWG paths |

## Backend feasibility and fallbacks

| Inventory group | Preferred backend | Feasibility / fallback |
|---|---|---|
| Core runtimes | mise core | Strong multi-platform support; exact versions locked |
| GitHub-distributed single binaries | aqua or GitHub | Preferred because lockfiles retain URL/checksum/provenance |
| npm CLIs and MCP servers | npm backend or repository `npm ci` | Exact package pins and committed npm lockfiles; repository packages use `npm ci` to preserve transitive versions |
| Rust/Go utilities | cargo/go backend | Use only when prebuilt aqua/ubi artifact is unavailable; lockfile may record version only |
| Python CLIs | pipx | Use for packages such as yamllint; exact top-level pin |
| TWG raw vendor binary | HTTP | Strong fit: four explicit platform URLs, checksums, `bin = "twg"`; Linux still needs native runtime validation |
| Native libraries, shells, tmux, containers, macOS services | bootstrap package managers | Homebrew/apt are appropriate because these need shared native integration |
| GUI apps and fonts | Homebrew reconciliation / MAS | Current releases by decision; existing Homebrew ownership is preserved, bootstrap installs only missing casks, and explicit update tasks upgrade installed casks |
| Azure CLI | pipx/ubi first | If a reliable standalone backend cannot reproduce the official CLI, use Homebrew on macOS and document Linux CI as metadata/config validation only |
| Google Cloud SDK | Homebrew/native archive | Native integration and component layout make a bootstrap package preferable to an ad-hoc runtime backend |
| Snowflake CLI | vendor cask | Bundle path and vendor tap are required; explicitly append app-bundle executable directory |

## Deletion gate

Nix implementation may be deleted only when:

- both `mise --env personal-macos ...` and `mise --env work-macos ...` parse;
- every row above has a real file/task/config destination;
- clean-environment Pi and Neovim checks pass or are represented in focused CI where the host dependency is unavailable locally;
- the repository guard rejects active references to removed runtime paths;
- cutover and later manual Nix uninstallation are documented; and
- no bootstrap has been applied to the current workstation during implementation.
