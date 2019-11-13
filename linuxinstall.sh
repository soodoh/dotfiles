# Add config folders
mkdir -p ${HOME}/.config/sway

# Add symlinks
ln -sf $(pwd)/swayconfig ${HOME}/.config/sway/config
ln -sf $(pwd)/swaybar.sh ${HOME}/.config/sway/swaybar.sh
