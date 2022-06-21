# Start Tmux automatically
if command -v tmux &> /dev/null && [ -z "$TMUX" ]; then
  echo "Loading TMUX..."
  tmux attach -t default || tmux new -s default
fi

# Set aliases from a separate file
source $HOME/.config/zsh/aliases.sh

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

# Use Starship for terminal prompt
eval "$(starship init zsh)"

# ZSH plugin manager
source "$HOME/.config/zgenom/zgenom.zsh"
if ! zgenom saved; then
  zgenom compdef
  zgenom ohmyzsh plugins/git
  zgenom ohmyzsh plugins/tmux
  zgenom ohmyzsh plugins/docker-compose
  zgenom ohmyzsh plugins/colored-man-pages
  zgenom load zsh-users/zsh-syntax-highlighting
  zgenom load zsh-users/zsh-autosuggestions
  zgenom load zsh-users/zsh-completions
  zgenom load jeffreytse/zsh-vi-mode

  zgenom save
  zgenom compile "$HOME/.zshrc"
  zgenom compile $ZDOTDIR
fi
# Settings for zsh-vi-mode
ZVM_VI_INSERT_ESCAPE_BINDKEY=jk

# Include Cargo packages in $PATH
PATH=$HOME/.cargo/bin:$PATH
# Include Go packages in $PATH
export GOPATH=$HOME/go
PATH=$GOPATH/bin:$PATH
