# Claude Code and other local binaries
fish_add_path -aP $HOME/.local/bin

# Cargo packages
if command -q cargo
    fish_add_path -aP $HOME/.cargo/bin
end

# Go packages
if command -q go
    set -gx GOPATH $HOME/go
    fish_add_path -aP $GOPATH/bin
end
