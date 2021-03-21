#!/bin/bash

# After Install:
# - Open Neovim and run command to install Tmux plugins
# - Add Nord theme to Slack

# Get filepath of this script
FILE_PATH=$(dirname $(dirname $SCRIPT_PATH))

# TODO if MAC
# TODO install brew
# brew update && brew upgrade
# brew install coreutils \
#   zsh \
#   tmux \
#   neovim \
#   yabai \
#   skhd \
#   alacritty \
#   fzf \
#   ripgrep
#   z

# TODO if Arch
# pacman -Syu alacritty \
#   zsh \
#   tmux \
#   neovim \
#   fzf \
#   ripgrep \
#   z

# TODO if Ubuntu
# apt-get update && apt-get upgrade
# apt-get install alacritty \
#   zsh \
#   tmux \
#   neovim \
#   fzf \
#   ripgrep \
#   z


# Install oh-my-zsh
# TODO check if installed already?
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Add custom plugins to oh-my-zsh directory
git clone https://github.com/zsh-users/zsh-autosuggestions $HOME/.oh-my-zsh/custom/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git $HOME/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting
# Installs tmux plugin manager
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
# Installs nnn plugins
curl -Ls https://raw.githubusercontent.com/jarun/nnn/master/plugins/getplugs | sh

# Without the -n it adds a symlinked directory with the same name inside its own directory
ln -sfn $FILEPATH/oh-my-zsh $HOME/.oh-my-zsh

# TODO move these into .config
ln -sf $FILEPATH/zshrc $HOME/.zshrc
ln -sf $FILEPATH/tmux.conf $HOME/.tmux.conf

# Create UltiSnips in .vim folder
mkdir -p ~/.config/coc
ln -sfn $FILEPATH/ultisnips $HOME/.config/coc/ultisnips
ln -sf $FILEPATH/coc-settings.json $HOME/.config/nvim/coc-settings.json

# Finally link Neovim's config
mkdir -p ~/.config/nvim
ln -sf $FILEPATH/vimrc $HOME/.config/nvim/init.vim

# Install Alacritty for both Mac & Linux
mkdir -p ~/.config/alacritty
ln -sf $FILEPATH/alacritty/alacritty.yml $HOME/.config/alacritty/alacritty.yml

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
# Add config folders
# mkdir -p ${HOME}/.config/sway

# Add symlinks
# ln -sf $(pwd)/swayconfig ${HOME}/.config/sway/config
# ln -sf $(pwd)/swaybar.sh ${HOME}/.config/sway/swaybar.sh
