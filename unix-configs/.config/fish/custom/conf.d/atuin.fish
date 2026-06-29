# Atuin shell history
# Replaces Sponge for cleaner, tmux-safe history tracking.
if status is-interactive; and command -q atuin
    # Keep Ctrl-R for Atuin's UI, but leave Up Arrow on fish's normal history recall.
    atuin init fish --disable-up-arrow | source
end
