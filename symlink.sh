#!/bin/bash

# For now, I'm assuming this repo is in my specific Dropbox filepath
FILEPATH=${HOME}/Dropbox/dotfiles
git submodule update -f

# Without the -n it adds a symlinked directory with the same name inside its own directory
ln -s -f -n $FILEPATH/oh-my-zsh ${HOME}/.oh-my-zsh
ln -s -f $FILEPATH/vimrc ${HOME}/.vimrc
ln -s -f $FILEPATH/zshrc ${HOME}/.zshrc
ln -s -f $FILEPATH/tmux.conf.local ${HOME}/.tmux.conf.local
ln -s -f $FILEPATH/oh-my-tmux/.tmux.conf ${HOME}/.tmux.conf

# Create nvim directories if they don't exist
mkdir -p ${HOME}/.config/nvim

# Finally link Neovim's config
ln -s -f $FILEPATH/vimrc ~/.config/nvim/init.vim
