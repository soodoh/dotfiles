# Start Tmux automatically
if command -v tmux &> /dev/null && [ -z "$TMUX" ]; then
  echo "Loading TMUX..."
  tmux attach -t default || tmux new -s default
fi

# Set aliases from a separate file
source ~/dotfiles/aliases.sh

# Stuff for oh-my-zsh
export ZSH="$HOME/.oh-my-zsh"
plugins=(
  colored-man-pages
  command-not-found
  vi-mode
  # Custom ones
  zsh-syntax-highlighting
  zsh-autosuggestions
  zsh-vimode-visual
)
source $ZSH/oh-my-zsh.sh

# Add LF_ICONS env var for lf icons
# Strips comments from the file, trims whitespace, then formats for LF
LF_ICONS=$(cat ~/.config/lf/icons | sed \
  -e '/^[ \t]*#/d'   \
  -e '/^[ \s]*$/d'   \
  -e 's/^[ \s]*//'    \
  -e 's/[ \s]*$//'    \
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
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
# Set node version
nvm use --lts

# Use Starship for terminal prompt
eval "$(starship init zsh)"
