# How to set up entire environment

## Mac Install

1. Install Homebrew

   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

1. Install tools

   ```
   brew update && brew upgrade
   brew install --cask --no-quarantine alacritty
   brew install \
    lf \
    coreutils \
    trash \
    tmux \
    neovim \
    koekeishiya/formulae/yabai \
    koekeishiya/formulae/skhd \
    ripgrep \
    stow \
   ```

1. Install command-not-found functionality (like Ubunut's apt-get)

   ```
   brew tap homebrew/command-not-found
   ```

1. Symlink Mac dotfiles

   ```
   stow mac-specific
   ```

1. Start Yabai & SKHD services

   ```
   brew services start skhd
   brew services start yabai
   ```

1. Install Neovim dependencies

   ```
   pip3 install neovim
   ```

1. Install NERD fonts

   - Maintained here: https://github.com/ryanoasis/nerd-fonts
   - Alacritty.yml uses `DroidSansMono`
   - Install manually: https://github.com/ryanoasis/nerd-fonts/raw/master/patched-fonts/DroidSansMono/complete/Droid%20Sans%20Mono%20Nerd%20Font%20Complete.otf

1. Follow [platform agnostic](#platform-agnostic-install) steps

## Linux Install

1. Install tools

   a. (Debian-based)

   ```
   apt-get update && apt-get upgrade
   apt-get install \
     alacritty \
     zsh \
     tmux \
     neovim \
     ripgrep \
     lm-sensors \
     stow \
   ```

   b. (Arch-based)

   ```
   pacman -Syu \
     alacritty \
     zsh \
     tmux \
     neovim \
     ripgrep \
     lm-sensors \
     free \
     stow \
   ```

1. Symlink Linux specific dotfiles

   ```
   stow linux-specific
   ```

1. Install NERD fonts

   ```
   mkdir -p ~/.local/share/fonts
   wget -P "$HOME/.local/share/fonts/Droid Sans Mono for Powerline Nerd Font Complete.otf" https://github.com/ryanoasis/nerd-fonts/raw/master/patched-fonts/DroidSansMono/complete/Droid%20Sans%20Mono%20Nerd%20Font%20Complete.otf
   fi
   ```

1. Install `lf`

   - Grab tarball here: https://github.com/gokcehan/lf/releases

   ```
   wget https://github.com/gokcehan/lf/releases/download/r6/lf-linux-amd64.tar.gz -O lf-linux-amd64.tar.gz
   tar xvf lf-linux-amd64.tar.gz
   chmod +x lf
   sudo mv lf /usr/local/bin
   rm lf-linux-amd64.tar.gz
   ```

1. Follow [platform agnostic](#platform-agnostic-install) steps

## Platform Agnostic Install

1. Install git, if that's not included in the distro

1. Setup git config

   ```
   git config --global user.name "Paul DiLoreto"
   git config --global user.email "paul.diloreto@gmail.com"
   ```

1. Install ZSH plugins

   ```
   git clone https://github.com/zsh-users/zsh-autosuggestions \
      $ZDOTDIR/plugins/zsh-autosuggestions
   git clone https://github.com/zsh-users/zsh-syntax-highlighting.git \
      $ZDOTDIR/plugins/zsh-syntax-highlighting
   git clone https://github.com/jeffreytse/zsh-vi-mode \
      $ZDOTDIR/plugins/zsh-vi-mode
   git clone https://github.com/ael-code/zsh-colored-man-pages.git \
      $ZDOTDIR/plugins/zsh-colored-man-pages
   ```

1. Set zsh as default shell

   ```
   chsh -s $(which zsh)
   ```

1. Install starship

   ```
   sh -c "$(curl -fsSL https://starship.rs/install.sh)"
   ```

1. Install Z script

   ```
   git clone https://github.com/rupa/z.git ~/.config/z
   ```

1. Install nvm (skip on work computer)

   ```
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.37.2/install.sh | bash
   nvm install --lts
   ```

1. Symlink platform-agnostic dotfiles

   ```
   stow multi-platform
   ```

1. Install tmux plugin manager

   ```
   git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
   ```

1. Open Neovim and run `:PackerInstall`

1. Open Tmux and install tmux plugins (\<prefix\> + I)
