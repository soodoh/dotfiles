set -gx LANG en_US.UTF-8
set -gx LC_CTYPE en_US.UTF-8
set -g fish_greeting
fish_add_path --path "$HOME/.local/bin"

# Keep local secrets in ~/.config/fish/conf.d/00-secrets.fish. This repository
# intentionally does not manage that file.
set -a fish_function_path \
    ~/.config/fish/plugins/abbreviation-tips/functions \
    ~/.config/fish/custom/functions

if command -q mise
    mise activate fish | source
end

if status is-interactive
    set -gx GPG_TTY (tty)

    if test -f ~/.config/fish/plugins/abbreviation-tips/conf.d/abbr_tips.fish
        source ~/.config/fish/plugins/abbreviation-tips/conf.d/abbr_tips.fish
    end

    for file in ~/.config/fish/custom/conf.d/*.fish
        test -f "$file"; and source "$file"
    end

    if command -q fnm
        fnm env --use-on-cd --shell fish | source
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

    fish_hybrid_key_bindings
    if functions -q __abbr_tips_init
        __abbr_tips_init
    end

    if command -q tmux; and not set -q TMUX; and not set -q VSCODE_RESOLVING_ENVIRONMENT
        if test "$TERM_PROGRAM" != vscode; and test "$TERM_PROGRAM" != zed
            if command tmux has-session 2>/dev/null
                command tmux attach
            else
                command tmux new-session -s main
            end
        end
    end
end
