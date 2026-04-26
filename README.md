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
  borders \
  cmake \
  coreutils \
  fd \
  fish \
  fzf \
  git \
  golang \
  jq \
  jstkdng/programs/ueberzugpp \
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
  wget \
  zoxide \
  zsh \
&& \
brew tap homebrew/command-not-found && \
brew install --cask \
  dotnet-sdk \
  nikitabobko/tap/aerospace \
  steipete/tap/codexbar \
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
  cmake \
  fd-find \
  fish \
  fzf \
  git \
  golang \
  lazygit \
  neovim \
  ripgrep \
  stow \
  tmux \
  wget \
  zoxide \
  zsh
```

Install sesh with Go:
```bash
go install github.com/joshmedeski/sesh/v2@latest
```

Arch
```bash
pacman -Syu \
  cmake \
  fd \
  fish \
  fzf \
  git \
  golang \
  lazygit \
  neovim \
  ripgrep \
  stow \
  tmux \
  yay \
  wget \
  zoxide \
  zsh
```

Install sesh from the AUR:
```bash
yay -S sesh-bin
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
```

1.Install Claude Code / Codex

Happier CLI (remote session support):
```bash
curl -fsSL https://happier.dev/install | bash
happier auth login
```

Claude Code (all platforms):
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Mac:
```bash
brew install --cask codex
```

If `codexbar` and `jq` are installed, SketchyBar will show per-provider AI usage badges for providers that currently return usable data from `codexbar usage --format json`.

Linux (after `fnm` is installed):
```bash
npm i -g @openai/codex 
```

1. Setup shell config

Zsh:
```bash
echo "source $HOME/.config/zsh/.zshrc" > $HOME/.zshrc
```

Fish (no sourcing needed — stow symlinks `~/.config/fish/` directly). Install fisher and plugins:
```bash
curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher
```

For secrets/API keys, create a file outside stow:
```bash
echo "set -gx OPENAI_API_KEY XXXXX" > $HOME/.config/fish/conf.d/00-secrets.fish
```

(Optional) Add environment variables for zsh:
```bash
echo "export OPENAI_API_KEY=XXXXX" >> $HOME/.zshrc
```

1. Symlink dotfiles

Mac:
```bash
mkdir ~/.config && \
stow -vRt $HOME unix-configs && \
stow -vRt $HOME mac-configs
```

Linux:
```bash
mkdir ~/.config && \
stow -vRt $HOME unix-configs
```
(Optional)
```bash
stow -vRt $HOME sway-configs
```

1. Install bun

    Follow [installation instructions](https://bun.com/docs/installation) for bun

    ```bash
    curl -fsSL https://bun.com/install | bash
    ```

1. Setup git config

    ```bash
    git config --global user.name "Paul DiLoreto" ;\
    git config --global user.email "soodohh@pm.me"
    git config --global core.excludesfile "$HOME/.config/.gitignore_global"
    ```

1.  Set default shell

    Fish:
    ```bash
    command -v fish | sudo tee -a /etc/shells
    chsh -s $(command -v fish)
    ```

    Zsh:
    ```bash
    command -v zsh | sudo tee -a /etc/shells
    chsh -s $(command -v zsh)
    ```

    If this fails with "non-standard shell", run this first & try again:
    ```bash
    # For fish:
    sudo sh -c 'echo "$(which fish)" >> /etc/shells'
    # For zsh:
    sudo sh -c 'echo "/opt/homebrew/bin/zsh" >> /etc/shells'
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
yay -S ttf-firacode-nerd
```

Ubuntu/Debian:
```bash
mkdir -p ~/.local/share/fonts && \
wget -P "$HOME/.local/share/fonts" https://github.com/ryanoasis/nerd-fonts/blob/master/patched-fonts/FiraCode/Regular/FiraCodeNerdFontMono-Regular.ttf
```


## Setup Neovim

1.  Install Neovim dependencies

```bash
npm i -g neovim
```

Mac:
```bash
pip3 install neovim
brew install neovim-remote
```

Ubuntu/Debian:
```bash
apt install python3-venv python3-neovim
pip install neovim-remote
```

1. Run `nvim` and run `:Lazy`, press `U` to update all packages

1. In nvim, run `:Mason` and update/install all tools

1. (Optional) `:Copilot auth`
