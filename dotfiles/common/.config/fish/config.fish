set -gx EDITOR nvim
set -gx VISUAL nvim
set -gx LANG en_US.UTF-8
set -gx LC_CTYPE en_US.UTF-8
set -g fish_greeting
fish_add_path --path "$HOME/.local/bin"

if status is-interactive
    set -gx GPG_TTY (tty)
end

# Keep local secrets in ~/.config/fish/conf.d/00-secrets.fish. This repository
# intentionally does not manage that file.
set -a fish_function_path \
    ~/.config/fish/plugins/git/functions \
    ~/.config/fish/plugins/abbreviation-tips/functions \
    ~/.config/fish/custom/functions

if test -f ~/.config/fish/plugins/abbreviation-tips/conf.d/abbr_tips.fish
    source ~/.config/fish/plugins/abbreviation-tips/conf.d/abbr_tips.fish
end

if functions -q __git.init
    __git.init
end

for file in ~/.config/fish/custom/conf.d/*.fish
    test -f "$file"; and source "$file"
end

if command -q mise
    mise activate fish | source
end
if command -q rustc
    set -gx RUST_SRC_PATH (rustc --print sysroot)/lib/rustlib/src/rust/library
end
if command -q starship
    starship init fish | source
end
if command -q zoxide
    zoxide init fish | source
end
if command -q atuin
    atuin init fish --disable-up-arrow | source
end
if command -q fzf
    fzf --fish | source
end

fish_vi_key_bindings
if functions -q __abbr_tips_init
    __abbr_tips_init
end

if status is-interactive; and command -q tmux; and not set -q TMUX; and not set -q VSCODE_RESOLVING_ENVIRONMENT
    if test "$TERM_PROGRAM" != vscode; and test "$TERM_PROGRAM" != zed
        if command tmux has-session 2>/dev/null
            command tmux attach
        else
            command tmux new-session -s main
        end
    end
end
