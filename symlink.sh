#!/bin/bash

# Prerequisites:
# - Install zsh
# - Install tmux
# - Install neovim
# - Install fzf
# - Install ripgrep

# For Mac:
# - Install yabai
# - Install skhd

# For Linux:
# - Install alacritty

# I assume the script is being run from it's own directory
FILEPATH=$(pwd)

# Revert oh-my-zsh and oh-my-tmux to master branch
git submodule update --init --recursive
# Add custom plugins to oh-my-zsh directory
git clone https://github.com/zsh-users/zsh-autosuggestions $FILEPATH/oh-my-zsh/custom/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git $FILEPATH/oh-my-zsh/custom/plugins/zsh-syntax-highlighting
# Installs tmux plugin manager
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
# Installs nnn plugins
curl -Ls https://raw.githubusercontent.com/jarun/nnn/master/plugins/getplugs | sh

# Without the -n it adds a symlinked directory with the same name inside its own directory
ln -sfn $FILEPATH/oh-my-zsh ~/.oh-my-zsh


# TODO move these into .config
ln -sf $FILEPATH/zshrc ~/.zshrc
ln -sf $FILEPATH/tmux.conf.local ~/.tmux.conf.local
ln -sf $FILEPATH/oh-my-tmux/.tmux.conf ~/.tmux.conf

# Create UltiSnips in .vim folder
mkdir -p ~/.config/coc
ln -s -f $FILEPATH/ultisnips ~/.config/coc/ultisnips

# Finally link Neovim's config
mkdir -p ~/.config/nvim
ln -s -f $FILEPATH/vimrc ~/.config/nvim/init.vim

# Install vim-plug (should work on Mac & Linux)
# Neovim
# curl -fLo ~/.config/nvim/autoload/plug.vim --create-dirs \
#    https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim

# Mac-specific settings
# mkdir -p ~/.config/yabai
# mkdir -p ~/.config/skhd
# ln -sf $FILEPATH/yabairc ~/.config/yabai/yabairc
# ln -sf $FILEPATH/skhdrc ~/.config/skhd/skhdrc

# Linux-specific settings
# TODO add alacritty
