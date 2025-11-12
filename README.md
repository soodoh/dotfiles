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
  fzf \
  git \
  golang \
  jstkdng/programs/ueberzugpp \
  neovim \
  ripgrep \
  scroll-reverser \
  sketchybar \
  stow \
  trash \
  wget \
  yazi \
  zellij \
  zoxide \
  zsh \
&& \
brew install --cask dotnet-sdk && \
brew tap homebrew/command-not-found && \
brew install --cask nikitabobko/tap/aerospace && \
defaults write -g NSWindowShouldDragOnGesture -bool true

# Install terminal emulator of choice
brew install --cask wezterm@nightly
```

Debian/Ubuntu
```bash
apt update && apt upgrade ;\
apt install \
  cmake \
  fd \
  fzf \
  git \
  golang \
  neovim
  ripgrep \
  stow \
  wget \
  yazi \
  zellij \
  zoxide \
  zsh \
```

Arch
```bash
pacman -Syu \
  cmake \
  fd \
  fzf \
  git \
  golang \
  neovim
  ripgrep \
  stow \
  yay \
  yazi \
  wget \
  zellij \
  zoxide \
  zsh \
```

1. Install rust

View [latest documentation](https://www.rust-lang.org/tools/install) & follow install instructions.
After installing, run this:

```bash
rustup update
# Unless using package managers for this
cargo install --locked zellij
```

1. Source `.zshrc`

```bash
echo "source $HOME/.config/zsh/.zshrc" > $HOME/.zshrc
```

(Optional) Add environment variables:
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

1.  Install starship

    ```bash
    sh -c "$(curl -fsSL https://starship.rs/install.sh)"
    ```

1.  Install NVM

    Follow [installation instructions](https://github.com/nvm-sh/nvm) for nvm

    Set/install default version of node to LTS, then install global NPM packages:

    ```bash
    nvm install 'lts/*' && \
    nvm alias default 'lts/*' && \
    npm i -g yarn neovim yalc
    ```

1. Setup git config

    ```bash
    git config --global user.name "Paul DiLoreto" ;\
    git config --global user.email "paul.diloreto@gmail.com"
    ```

1.  Set zsh as default shell

    ```bash
    chsh -s $(which zsh)
    ```

    If this fails with "non-standard shell", run this first & try again:
    ```bash
    sudo sh -c 'echo "/opt/homebrew/bin/zsh" >> /etc/shells'
    ```

1. Install NERD fonts

[Patched fonts](https://github.com/ryanoasis/nerd-fonts/raw/master/patched-fonts)

Alacritty.yml/Kitty.conf uses [FiraCode Nerd Font Mono](https://github.com/ryanoasis/nerd-fonts/blob/master/patched-fonts/FiraCode/Regular/FiraCodeNerdFontMono-Regular.ttf)

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

Mac:
```bash
pip3 install neovim && \
brew install \
  imagemagick
```

Ubuntu/Debian:
```bash
apt install python3-venv python3-neovim
```

1. Run `nvim` and run `:Lazy`, press `U` to update all packages

1. In nvim, run `:Mason` and update/install all tools

1. (Optional) `:Copilot auth`
