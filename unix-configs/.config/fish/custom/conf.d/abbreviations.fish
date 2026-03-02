# General
abbr -a vim nvim
abbr -a v nvim

# Git
abbr -a gdn 'git diff --name-only'
abbr -a gmc 'git merge --continue'
abbr -a --position anywhere -- nv --no-verify

# Tmux (replaces OMZ tmux plugin aliases)
abbr -a ta 'tmux attach'
abbr -a ts 'tmux new-session -s'
abbr -a tl 'tmux list-sessions'
abbr -a tksv 'tmux kill-server'
abbr -a tkss 'tmux kill-session -t'

# Bun/Node/JS
abbr -a ydx 'yarn dlx'
abbr -a ywk 'yarn workspace'
abbr -a yp 'yarn run build && yarn dlx yalc push'
abbr -a ypl 'yarn run build:library && yarn dlx yalc push'
abbr -a bp 'bun run build && bunx yalc push'
abbr -a bx bunx
