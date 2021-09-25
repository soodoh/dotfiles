#!/bin/bash

# After Install:
# - Open Neovim and run command to install Tmux plugins
# - Add Nord theme to Slack

# TODO if MAC
# TODO install brew
# brew update && brew upgrade
# brew install coreutils \
#   alacritty \
#   trash \
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
#   tmux \
#   neovim \
#   fzf \
#   ripgrep \
#   z \
#   lm-sensors \
#   free

# TODO if Ubuntu
# apt-get update && apt-get upgrade
# apt-get install alacritty \
#   zsh \
#   tmux \
#   neovim \
#   fzf \
#   ripgrep \
#   z \
#   lm-sensors \

# Install starship
sh -c "$(curl -fsSL https://starship.rs/install.sh)"

# Install oh-my-zsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Add custom plugins to oh-my-zsh directory
ZSH_CUSTOM_PLUGINS="${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins"
git clone https://github.com/zsh-users/zsh-autosuggestions $ZSH_CUSTOM_PLUGINS/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git $ZSH_CUSTOM_PLUGINS/zsh-syntax-highlighting
git clone https://github.com/b4b4r07/zsh-vimode-visual $ZSH_CUSTOM_PLUGINS/zsh-vimode-visual
git clone https://github.com/nyquase/vi-mode $ZSH_CUSTOM_PLUGINS/vi-mode
# Installs tmux plugin manager
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
# Installs nnn plugins
curl -Ls https://raw.githubusercontent.com/jarun/nnn/master/plugins/getplugs | sh

# TODO move these into .config
rm ~/.zshrc
ln -s $(realpath ./zshrc) ~/.zshrc
rm ~/.tmux.conf
ln -s $(realpath ./tmux.conf) ~/.tmux.conf

# Create UltiSnips in .vim folder
rm -rf ~/.config/coc
mkdir -p ~/.config/coc
ln -sfn $(realpath ./ultisnips) ~/.config/coc/ultisnips
ln -sf $(realpath ./coc-settings.json) ~/.config/nvim/coc-settings.json

# Symlink Neovim's config
mkdir -p ~/.config/nvim
ln -s $(realpath ./vimrc) ~/.config/nvim/init.vim

# Symlink custom Neovim fzf wrapper
mkdir -p ~/.config/nvim/autoload/floaterm/wrapper
ln -s $(realpath ./fzf.vim) ~/.config/nvim/autoload/floaterm/wrapper/fzf.vim

# Symlink Alacritty folder for both Mac & Linux
rm -rf ~/.config/alacritty
mkdir -p ~/.config/alacritty
ln -s $(realpath ./alacritty.yml) ~/.config/alacritty/alacritty.yml

# Symlink lf config
rm -rf ~/.config/lf
ln -sfn $(realpath ./lf) ~/.config/lf

# Symlink Starship configuration
rm -r ~/.config/starship.toml
ln -s $(realpath ./starship.toml) ~/.config/starship/toml

# Install vim-plug (should work on Mac & Linux)
# Neovim
# curl -fLo ~/.config/nvim/autoload/plug.vim --create-dirs \
#    https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim

#### Mac-specific settings

# rm -rf ~/.config/yabai
# mkdir -p ~/.config/yabai
# rm -rf ~/.config/skhd
# mkdir -p ~/.config/skhd
# ln -sf $(realpath ./yabairc) ~/.config/yabai/yabairc
# ln -sf $(realpath ./skhdrc) ~/.config/skhd/skhdrc

#### Linux-specific settings

# Symlinks for Sway
# rm -rf ~/.config/sway
# mkdir -p ~/.config/sway
# ln -sf $(pwd)/swayconfig ${HOME}/.config/sway/config
# ln -sf $(pwd)/swaybar.sh ${HOME}/.config/sway/swaybar.sh
