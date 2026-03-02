# Homebrew shellenv
if test -x /opt/homebrew/bin/brew
    /opt/homebrew/bin/brew shellenv | source
end

# Koreader dev dependencies (GNU utils)
if command -q brew
    fish_add_path -pP (brew --prefix)/opt/findutils/libexec/gnubin
    fish_add_path -pP (brew --prefix)/opt/gnu-getopt/bin
    fish_add_path -pP (brew --prefix)/opt/make/libexec/gnubin
    fish_add_path -pP (brew --prefix)/opt/util-linux/bin

    # ImageMagick + Nvim
    set -gx DYLD_LIBRARY_PATH (brew --prefix)/lib/
end
