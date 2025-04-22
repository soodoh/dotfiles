#yabai How to set up entire environment

## Platform Agnostic Install

1. Run platform specific steps first, then continue here!

1. Install git, if that's not included in the distro

1. Setup git config

    ```
    git config --global user.name "Paul DiLoreto"
    git config --global user.email "paul.diloreto@gmail.com"
    ```

1. Symlink platform-agnostic dotfiles

    ```
    mkdir ~/.config
    stow -v -R -t $HOME multi-platform
    ```

1. Setup `~/.zshrc` to be:

```
source $HOME/.config/zsh/.zshrc
# Replace with actual API key
export OPENAI_API_KEY=XXXXX
```

1.  Set zsh as default shell

    ```
    chsh -s $(which zsh)
    ```

1.  Install starship

    ```
    sh -c "$(curl -fsSL https://starship.rs/install.sh)"
    ```

1.  Install language runtimes

    ```
    brew install golang
    ```

    Follow Rust [installation instructions](https://www.rust-lang.org/tools/install)

1.  Install NVM

    Follow [installation instructions](https://github.com/nvm-sh/nvm) for nvm

    Set/install default version of node to LTS:

    ```
    nvm install 'lts/*'
    nvm alias default 'lts/*'
    ```

    Lastly, install some global NPM packages:

    ```
    npm i -g yarn neovim
    ```

1.  Install tmux plugin manager

    ```
    git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
    ```

1.  Install Neovim dependencies

    ```
    pip3 install neovim
    ```

    Image.nvim Dependencies

    ```
    # Ubuntu
    sudo apt install libmagickwand-dev

    # MacOS
    brew install imagemagick
    brew install jstkdng/programs/ueberzugpp
    # See https://github.com/3rd/image.nvim/issues/91#issuecomment-2417623824
    brew install pkgconfig
    ```

    Other:

    ```
    # Ubuntu
    apt-get install \
        cmake \
        python3-venv \
        python3-neovim

    # MacOS
    brew install cmake
    ```

    Open `nvim` and run `:Lazy`

1.  Open Tmux and install tmux plugins (\<prefix\> + I)

1.  Download NERD fonts

[Patched fonts](https://github.com/ryanoasis/nerd-fonts/raw/master/patched-fonts)

- Alacritty.yml/Kitty.conf uses `FiraCode Nerd Font Mono`
- [FiraCode Nerd Font Mono](https://github.com/ryanoasis/nerd-fonts/blob/master/patched-fonts/FiraCode/Regular/FiraCodeNerdFontMono-Regular.ttf)
- For mac installation, use homebrew: `brew install --cask font-fira-code-nerd-font`

```
# Linux
mkdir -p ~/.local/share/fonts
wget -P "$HOME/.local/share/fonts" $LINK_TO_FONT
```

## Mac Install

1. Install Homebrew

    ```
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ```

    Then run caveat command so that `brew` is in the `$PATH`. Once we symlink the `.zprofile`, this will happen automatically.

1. Install common tools

    ```
    brew update && brew upgrade
    brew install --cask alacritty
    brew install \
       coreutils \
       trash \
       tmux \
       neovim \
       ripgrep \
       stow \
       fzf \
       zoxide
    ```

1. Install various taps

    ```
    brew tap homebrew/command-not-found
    ```

    Aerospace:

    ```
    brew install --cask nikitabobko/tap/aerospace
    # Nice to have
    defaults write -g NSWindowShouldDragOnGesture -bool true
    ```

    JankyBorders + Sketchybar (used in aerospace.toml)

    ```
    brew tap FelixKratz/formulae
    brew install borders
    brew install sketchybar
    ```

1. Install Copilot

    CLI:

    ```
    brew install gh
    ```

    Follow [Github CLI install instructions](https://docs.github.com/en/copilot/managing-copilot/configure-personal-settings/installing-github-copilot-in-the-cli#installing-copilot-in-the-cli)

1. Symlink Mac dotfiles

    ```
    stow -v -R -t $HOME mac-specific
    ```

## Linux Install (Debian/Ubuntu)

1. Add custom repositories

    ```
    add-apt-repository ppa:neovim-ppa/unstable
    apt update && apt upgrade -y
    apt-get update && apt-get upgrade -y
    ```

1. Install tools

    ```
    apt-get install \
       neovim \
       alacritty \
       zsh \
       tmux \
       ripgrep \
       stow \
       fzf \
    ```

1. Symlink Linux specific dotfiles

    ```
    stow -v -R -t $HOME linux-specific
    ```
