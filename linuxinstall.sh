# Add config folders
mkdir -p ${HOME}/.config/sway

# Add symlinks
ln -sf $(pwd)/swayconfig ${HOME}/.config/sway/config
