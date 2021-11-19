# Start Tmux automatically
if command -v tmux &> /dev/null && [ -z "$TMUX" ]; then
  echo "Loading TMUX..."
  tmux attach -t default || tmux new -s default
fi

# Set aliases from a separate file
ZSH_FILES=$HOME/.config/zsh
source $ZSH_FILES/aliases.sh

# Settings for zsh-vi-mode
ZVM_VI_INSERT_ESCAPE_BINDKEY=jk

# Add LF_ICONS env var for lf icons
# Strips comments from the file, trims whitespace, then formats for LF
LF_ICONS=$(cat ~/.config/lf/icons | sed \
  -e '/^[ \t]*#/d'   \
  -e '/^[ \s]*$/d'   \
  -e 's/^[ \s]*//'   \
  -e 's/[ \s]*$//'   \
  -e 's/  */=/g'     \
  -e 's/$/ /')
LF_ICONS=${LF_ICONS//$'\n'/:}
export LF_ICONS

# Preferred editor for local and remote sessions
export EDITOR='nvim'
export VISUAL='nvim'

# Load z
[ -f ~/.config/z/z.sh ] && . ~/.config/z/z.sh

# Stuff for NVM (Node version manager)
# export NVM_DIR="$HOME/.nvm"
# [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
# [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
# nvm use --lts

# Use Starship for terminal prompt
eval "$(starship init zsh)"

# Load ZSH plugins
[ -f $ZSH_FILES/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh ] &&
  source $ZSH_FILES/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
[ -f $ZSH_FILES/plugins/zsh-colored-man-pages/colored-man-pages.plugin.zsh ] &&
  source $ZSH_FILES/plugins/zsh-colored-man-pages/colored-man-pages.plugin.zsh
[ -f $ZSH_FILES/plugins/zsh-vi-mode/zsh-vi-mode.zsh ] &&
  source $ZSH_FILES/plugins/zsh-vi-mode/zsh-vi-mode.zsh
[ -f $ZSH_FILES/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ] &&
  source $ZSH_FILES/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
