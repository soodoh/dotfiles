# Personal Dev Environment

## Configuration Steps

1. Install homebrew (Mac only)

Note: cross reference [official documented](https://brew.sh/) install steps
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Add homebrew to `$PATH` for current session so that the follow steps can access homebrew packages.
```bash
export PATH=$PATH:/opt/homebrew/bin
```

1. Install dependencies

Mac:
```bash
brew install \
  atuin \
  borders \
  fish \
  fzf \
  git \
  gnupg \
  golang \
  jq \
  lazygit \
  neovim \
  ripgrep \
  scroll-reverser \
  sesh \
  sketchybar \
  starship \
  stow \
  tmux \
  trash \
  tree-sitter-cli \
  uv \
  wget \
  zoxide
&& \
brew tap homebrew/command-not-found && \
brew install --cask \
  nikitabobko/tap/aerospace \
&& \
defaults write -g NSWindowShouldDragOnGesture -bool true
```

Debian/Ubuntu

Add Neovim unstable PPA for latest version:
```bash
echo "deb https://ppa.launchpadcontent.net/neovim-ppa/unstable/ubuntu noble main" | sudo tee /etc/apt/sources.list.d/neovim-unstable.list
curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x9DBB0BE9366964F134855E2255F96FCF8231B6DD" | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/neovim-ppa.gpg
```

```bash
apt update && apt upgrade ;\
apt install \
  fish \
  fzf \
  git \
  golang \
  lazygit \
  neovim \
  python3 \
  python3-venv \
  ripgrep \
  stow \
  tmux \
  tree-sitter-cli \
  wget \
  zoxide
```

The live Pi picker requires fzf 0.44.1 or newer (Ubuntu 24.04+ or Debian 13+).

Install sesh with Go:
```bash
go install github.com/joshmedeski/sesh/v2@latest
```

Arch
```bash
pacman -Syu \
  fish \
  fzf \
  git \
  golang \
  lazygit \
  neovim \
  python \
  ripgrep \
  stow \
  tmux \
  tree-sitter-cli \
  wget \
  zoxide
```

(Arch/Debian) Install sesh with Go:
```bash
go install github.com/joshmedeski/sesh/v2@latest
```

1. Install `fnm` (instead of `nvm`)

Mac:
```bash
brew install fnm
```

Debian/Arch:
```bash
curl -fsSL https://fnm.vercel.app/install | bash
```

1. Install rust

View [latest documentation](https://www.rust-lang.org/tools/install) & follow install instructions.
After installing, run this:

```bash
rustup update
```

Linux only (otherwise handled by homebrew):
```bash
cargo install --force yazi-build
cargo install starship --locked
cargo install atuin --locked
```

1.Install Agents

(Optionally install Codex/Claude Code; view upstream documentation)

Pi:
```bash
bun add -g @earendil-works/pi-coding-agent
```

# Agent tools (personal)

```bash
bun add -g @jarkkojs/readseek
```

# Agent tools (for work, so macOS only):

```bash
# Atlassian
curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install | bash
twg setup

# Snowflake
brew install snowflake-cli

# Azure
brew install azure-cli
```

1. Setup shell config

Fish (no sourcing needed — stow symlinks `~/.config/fish/` directly). Install fisher and plugins:
```bash
curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher
```

For secrets/API keys, create a file outside stow:
```bash
echo "set -gx OPENAI_API_KEY XXXXX" > $HOME/.config/fish/conf.d/00-secrets.fish
```

1. Symlink dotfiles

Mac:
```bash
mkdir ~/.config && \
stow -vRt $HOME unix-configs && \
stow -vRt $HOME mac-configs && \
mkdir -p "$HOME/.pi/agent" && \
ln -sfn "$PWD/pi-extensions" "$HOME/.pi/agent/pi-extensions"
```

Linux:
```bash
mkdir ~/.config && \
stow -vRt $HOME unix-configs && \
mkdir -p "$HOME/.pi/agent" && \
ln -sfn "$PWD/pi-extensions" "$HOME/.pi/agent/pi-extensions"
```
(Optional)
```bash
stow -vRt $HOME sway-configs
```

1. Install bun

    Follow [installation instructions](https://bun.com/docs/installation) for bun

    ```bash
    curl -fsSL https://bun.com/install | bash
    bun install
    ```

    The root Bun workspace installs both the repository tooling and the runtime dependencies for `pi-extensions`. No separate install inside `pi-extensions/` is needed.

1. Setup git config

    ```bash
    git config --global user.name "Paul DiLoreto" ;\
    git config --global user.email "soodohh@pm.me"
    git config --global core.excludesfile "$HOME/.config/.gitignore_global"
    ```

1.  Set default shell to Fish

    ```bash
    command -v fish | sudo tee -a /etc/shells
    chsh -s $(command -v fish)
    ```

1. Install NERD fonts

[Patched fonts](https://github.com/ryanoasis/nerd-fonts/raw/master/patched-fonts)

Ghostty config uses [FiraCode Nerd Font Mono](https://github.com/ryanoasis/nerd-fonts/blob/master/patched-fonts/FiraCode/Regular/FiraCodeNerdFontMono-Regular.ttf)

Mac:
```bash
brew install --cask font-fira-code-nerd-font
```

Arch:
```bash
sudo pacman -S ttf-firacode-nerd
```

Ubuntu/Debian:
```bash
mkdir -p ~/.local/share/fonts && \
wget -P "$HOME/.local/share/fonts" https://github.com/ryanoasis/nerd-fonts/blob/master/patched-fonts/FiraCode/Regular/FiraCodeNerdFontMono-Regular.ttf
```

1. Run `nvim` and run `:Lazy`, press `U` to update all packages

1. In nvim, run `:Mason` and update/install all tools
