# Atuin shell history
# Replaces Sponge for cleaner, tmux-safe history tracking.
if status is-interactive; and command -q atuin
    atuin init fish | source
end
