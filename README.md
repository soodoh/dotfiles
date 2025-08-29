# Personal Dev Environment

## Configuration Steps

1. Install homebrew (Mac only)

Note: cross reference [official documented](https://brew.sh/) install steps
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Add homebrew to `$PATH` for current session so that the follow steps can access homebrew packages.
```
export PATH=$PATH:/opt/homebrew/bin
```

1. Install dependencies

Mac:
```
brew install \
  git \
  zsh \
  coreutils \
  cmake \
  golang \
  stow \
  trash \
  ripgrep \
  fzf \
  zoxide \
  tmux \
  neovim \
  borders \
  sketchybar \
  scroll-reverser \
  block-goose-cli \
&& \
brew services start sketchybar && \
brew install --cask alacritty && \
brew tap homebrew/command-not-found && \
brew install --cask nikitabobko/tap/aerospace && \
brew install --cask mediosz/tap/swipeaerospace && \
defaults write -g NSWindowShouldDragOnGesture -bool true
```

Debian/Ubuntu
```
apt update && apt upgrade ;\
apt install \
  git \
  zsh \
  cmake \
  golang \
  stow \
  ripgrep \
  fzf \
  zoxide \
  tmux \
  neovim
```

Arch
```
pacman -Syu \
  yay \
  git \
  zsh \
  cmake \
  golang \
  stow \
  ripgrep \
  fzf \
  zoxide \
  tmux \
  neovim
```

1. Source `.zshrc`

```
echo "source $HOME/.config/zsh/.zshrc" > $HOME/.zshrc
```

(Optional) Add environment variables:
```
echo "export OPENAI_API_KEY=XXXXX" >> $HOME/.zshrc
```

1. Symlink dotfiles

Mac:
```
mkdir ~/.config && \
stow -vRt $HOME unix-configs ; \
stow -vRt $HOME mac-configs
```

Linux:
```
mkdir ~/.config && \
stow -vRt $HOME unix-configs
```
(Optional)
```
stow -vRt $HOME sway-configs
```

1.  Install starship

    ```
    sh -c "$(curl -fsSL https://starship.rs/install.sh)"
    ```

1.  Install NVM

    Follow [installation instructions](https://github.com/nvm-sh/nvm) for nvm

    Set/install default version of node to LTS, then install global NPM packages:

    ```
    nvm install 'lts/*' && \
    nvm alias default 'lts/*' && \
    npm i -g yarn neovim yalc
    ```

1. Setup git config

    ```
    git config --global user.name "Paul DiLoreto" ;\
    git config --global user.email "paul.diloreto@gmail.com"
    ```

1.  Set zsh as default shell

    ```
    chsh -s $(which zsh)
    ```

    If this fails with "non-standard shell", run this first & try again:
    ```
    sudo sh -c 'echo "/opt/homebrew/bin/zsh" >> /etc/shells'
    ```

1. Install NERD fonts

[Patched fonts](https://github.com/ryanoasis/nerd-fonts/raw/master/patched-fonts)

Alacritty.yml/Kitty.conf uses [FiraCode Nerd Font Mono](https://github.com/ryanoasis/nerd-fonts/blob/master/patched-fonts/FiraCode/Regular/FiraCodeNerdFontMono-Regular.ttf)

Mac:
```
brew install --cask font-fira-code-nerd-font
```

Arch:
```
yay -S ttf-firacode-nerd
```

Ubuntu/Debian:
```
mkdir -p ~/.local/share/fonts && \
wget -P "$HOME/.local/share/fonts" https://github.com/ryanoasis/nerd-fonts/blob/master/patched-fonts/FiraCode/Regular/FiraCodeNerdFontMono-Regular.ttf
```


## Setup Tmux

1. Install tmux plugin manager

    ```
    git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
    ```

1. Run `tmux` and install tmux plugins (\<prefix\> + I)

## Setup Neovim

1.  Install Neovim dependencies

Mac:
    ```
    pip3 install neovim
    ```

Ubuntu/Debian:
```
apt install python3-venv python3-neovim
```

1. Run `nvim` and run `:Lazy`, press `U` to update all packages

1. In nvim, run `:Mason` and update/install all tools

1. (Optional) `:Copilot auth`
