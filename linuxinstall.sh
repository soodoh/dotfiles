# Add config folders
mkdir -p ${HOME}/.config/i3

# Add symlinks
ln -sf $(pwd)/i3config ${HOME}/.config/i3/config
ln -sf $(pwd)/xinitrc ${HOME}/.xinitrc
ln -sf $(pwd)/Xresources ${HOME}/.Xresources
