# fnm (Fast Node Manager) - replaces nvm
status is-interactive; or return

if command -q fnm
    fnm env --use-on-cd --shell fish | source
end
