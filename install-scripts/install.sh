#!/bin/bash

# After Install:
# - Open Neovim and run :PlugInstall
# - Open Tmux and install tmux plugins (^a + I)
# - Add Nord theme to Slack

##################################################
#  Mac Install
if [ $OSTYPE =~ darwin* ]; then

# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# Install tools
brew update && brew upgrade
brew install --cask --no-quarantine alacritty
brew install \
  coreutils \
  trash \
  tmux \
  neovim \
  koekeishiya/formulae/yabai \
  koekeishiya/formulae/skhd \
  fzf \
  ripgrep \
# Command-not-found functionality like Ubuntu's apt-get
brew tap homebrew/command-not-found

# Yabai settings
[ -e ~/.config/yabai ] && rm -rf ~/.config/yabai
mkdir -p ~/.config/yabai
ln -sf $(realpath ./yabairc) ~/.config/yabai/yabairc
# SKHD settings
[ -e ~/.config/skhd ] && rm -rf ~/.config/skhd
mkdir -p ~/.config/skhd
ln -sf $(realpath ./skhdrc) ~/.config/skhd/skhdrc

##################################################
# Debian-based Install
elif [ $OSTYPE =~ linux* ] && command -v apt-get &> /dev/null; then

apt-get update && apt-get upgrade
apt-get install alacritty \
  zsh \
  tmux \
  neovim \
  fzf \
  ripgrep \
  lm-sensors \

##################################################
# Arch Linux Install
elif [ $OSTYPE =~ linux* ] && command -v pacman &> /dev/null; then

pacman -Syu alacritty \
  zsh \
  tmux \
  neovim \
  fzf \
  ripgrep \
  lm-sensors \
  free

# Sway (tiling window manager)
[ -e ~/.config/sway ] && rm -rf ~/.config/sway
ln -sfn $(realpath ./sway) ~/.config/sway

fi

##################################################
# The rest is platform agnostic

# I assume git is already installed
# Set git config
git config --global user.name "Paul DiLoreto"
git config --global user.email "paul.diloreto@gmail.com"

# Install oh-my-zsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# Install Nerd Fonts
# Maintained here: https://github.com/ryanoasis/nerd-fonts
mkdir -p ~/.local/share/fonts
wget -P "$HOME/.local/share/fonts/Droid Sans Mono for Powerline Nerd Font Complete.otf" https://github.com/ryanoasis/nerd-fonts/raw/master/patched-fonts/DroidSansMono/complete/Droid%20Sans%20Mono%20Nerd%20Font%20Complete.otf

# Install starship
sh -c "$(curl -fsSL https://starship.rs/install.sh)"

# Install LF
if [ $OSTYPE =~ darwin* ]; then
  # Mac install
  brew install lf
else
  # Linux install
  # Grab tarball here: https://github.com/gokcehan/lf/releases
  wget https://github.com/gokcehan/lf/releases/download/r6/lf-linux-amd64.tar.gz -O lf-linux-amd64.tar.gz
  tar xvf lf-linux-amd64.tar.gz
  chmod +x lf
  sudo mv lf /usr/local/bin
  rm lf-linux-amd64.tar.gz
fi
# Symlink lf config
[ -e ~/.config/lf ] && rm -rf ~/.config/lf
ln -sfn $(realpath ./lf) ~/.config/lf

# Install Z script
git clone https://github.com/rupa/z.git ~/.config/z

# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.37.2/install.sh | bash
nvm install --lts

# Installs tmux plugin manager
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm

# ZSH Settings
[ -e ~/.zshrc ] && rm ~/.zshrc
ln -s $(realpath ./zshrc) ~/.zshrc

# Tmux Settings
[ -e ~/.tmux.conf ] && rm ~/.tmux.conf
ln -s $(realpath ./tmux.conf) ~/.tmux.conf

# Neovim Settings
mkdir -p ~/.config/nvim
ln -s $(realpath ./vimrc) ~/.config/nvim/init.vim
# Install vim-plug
curl -fLo ~/.config/nvim/autoload/plug.vim --create-dirs https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
# Symlink custom Neovim fzf wrapper
mkdir -p ~/.config/nvim/autoload/floaterm/wrapper
ln -s $(realpath ./fzf.vim) ~/.config/nvim/autoload/floaterm/wrapper/fzf.vim
# Create UltiSnips in .vim folder
[ -e ~/.config/coc ] && rm -rf ~/.config/coc
mkdir -p ~/.config/coc
ln -sfn $(realpath ./ultisnips) ~/.config/coc/ultisnips
ln -sf $(realpath ./coc-settings.json) ~/.config/nvim/coc-settings.json

# Symlink Alacritty folder for both Mac & Linux
[ -e ~/.config/alacritty ] && rm -rf ~/.config/alacritty
mkdir -p ~/.config/alacritty
ln -s $(realpath ./alacritty.yml) ~/.config/alacritty/alacritty.yml

# Symlink Starship configuration
[ -e ~/.config/starship.toml ] && rm ~/.config/starship.toml
mkdir -p ~/.config/starship
ln -s $(realpath ./starship.toml) ~/.config/starship/toml

