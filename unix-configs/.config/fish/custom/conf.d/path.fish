# Homebrew (macOS)
if test -x /opt/homebrew/bin/brew
    /opt/homebrew/bin/brew shellenv | source
end

# Obsidian CLI (macOS)
if test -d /Applications/Obsidian.app/Contents/MacOS
  fish_add_path -aP /Applications/Obsidian.app/Contents/MacOS
end

# Claude Code and other local binaries
fish_add_path -aP $HOME/.local/bin

# Cargo packages
if test -d $HOME/.cargo/bin
    fish_add_path -aP $HOME/.cargo/bin
end

# Go packages
if command -q go
    set -gx GOPATH $HOME/go
    fish_add_path -aP $GOPATH/bin
end

# Bun
if test -d $HOME/.bun
    fish_add_path -aP $HOME/.bun/bin
end
