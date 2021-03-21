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
#   alacritty \
#   starship \
#   zsh \
#   tmux \
#   neovim \
#   yabai \
#   skhd \
#   fzf \
#   ripgrep \
#   z
# brew tap homebrew/command-not-found

# TODO if Arch
# pacman -Syu alacritty \
#   zsh \
#   starship \
#   tmux \
#   neovim \
#   fzf \
#   ripgrep \
#   z

# TODO if Ubuntu
# apt-get update && apt-get upgrade
# apt-get install alacritty \
#   zsh \
#   starship \
#   tmux \
#   neovim \
#   fzf \
#   ripgrep \
#   z


# Install oh-my-zsh
# TODO check if installed already?
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Add custom plugins to oh-my-zsh directory
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}
# Installs tmux plugin manager
git clone https://github.com/tmux-plugins/tpm $HOME/.tmux/plugins/tpm
# Installs nnn plugins
curl -Ls https://raw.githubusercontent.com/jarun/nnn/master/plugins/getplugs | sh

# TODO move these into .config
rm $HOME/.zshrc
ln -s $FILEPATH/zshrc $HOME/.zshrc
rm $HOME/.tmux.conf
ln -s $FILEPATH/tmux.conf $HOME/.tmux.conf

# Create UltiSnips in .vim folder
rm -rf $HOME/.config/coc
mkdir -p $HOME/.config/coc
ln -sfn $FILEPATH/ultisnips $HOME/.config/coc/ultisnips
ln -sf $FILEPATH/coc-settings.json $HOME/.config/nvim/coc-settings.json

# Symlink Neovim's config
mkdir -p $HOME/.config/nvim
ln -s $FILEPATH/vimrc $HOME/.config/nvim/init.vim

# Symlink Alacritty folder for both Mac & Linux
rm -rf $HOME/.config/alacritty
ln -sn $FILEPATH/alacritty $HOME/.config/alacritty

# Symlink Starship configuration
rm -r $HOME/.config/starship.toml
ln -s $FILEPATH/starship.toml $HOME/.config/starship/toml

# Install vim-plug (should work on Mac & Linux)
# Neovim
# curl -fLo $HOME/.config/nvim/autoload/plug.vim --create-dirs \
#    https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim

#### Mac-specific settings

# rm -rf $HOME/.config/yabai
# mkdir -p $HOME/.config/yabai
# rm -rf $HOME/.config/skhd
# mkdir -p $HOME/.config/skhd
# ln -sf $FILEPATH/yabairc $HOME/.config/yabai/yabairc
# ln -sf $FILEPATH/skhdrc $HOME/.config/skhd/skhdrc

#### Linux-specific settings

# Symlinks for Sway
# rm -rf $HOME/.config/sway
# mkdir -p $HOME/.config/sway
# ln -sf $(pwd)/swayconfig ${HOME}/.config/sway/config
# ln -sf $(pwd)/swaybar.sh ${HOME}/.config/sway/swaybar.sh
