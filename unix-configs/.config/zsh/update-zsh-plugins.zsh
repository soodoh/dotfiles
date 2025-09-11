#!/bin/zsh

ZSH_PLUGINS=$HOME/.config/zsh-plugins
REPOS=$(find $ZSH_PLUGINS -type d -d 2)

for VAL in $REPOS; do
  cd $VAL
  git fetch --all && git reset origin --hard
done
