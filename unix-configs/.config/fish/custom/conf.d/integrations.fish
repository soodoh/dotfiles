# Starship prompt
if command -q starship
    starship init fish | source
end

# Zoxide directory jumper
if command -q zoxide
    zoxide init fish | source
end
