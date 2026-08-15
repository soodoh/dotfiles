_:
let
  fishSource = ../../dotfiles/common/.config/fish;
  abbreviationTips = ../../dotfiles/common/.config/fish/plugins/abbreviation-tips;
  gitPlugin = ../../dotfiles/common/.config/fish/plugins/git;
  interactiveInit = ''
    set -gx EDITOR nvim
    set -gx VISUAL nvim
    set -gx LANG en_US.UTF-8
    set -gx LC_CTYPE en_US.UTF-8
    set -g fish_greeting
    set -gx GPG_TTY (tty)

    set -a fish_function_path ${fishSource}/custom/functions

    # The Git plugin normally creates its abbreviations during Fisher's install
    # event. Home Manager only exposes the immutable plugin files, so initialize
    # them explicitly before sourcing our overrides.
    if functions -q __git.init
      __git.init
    end
    set -l custom_conf_dir ${fishSource}/custom/conf.d
    for file in $custom_conf_dir/*.fish
      source $file
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

    if command -q tmux; and not set -q TMUX; and not set -q VSCODE_RESOLVING_ENVIRONMENT
      if test "$TERM_PROGRAM" != vscode; and test "$TERM_PROGRAM" != zed
        if command tmux has-session 2>/dev/null
          command tmux attach
        else
          command tmux new-session -s main
        end
      end
    end
  '';
in
{
  programs.fish = {
    enable = true;
    generateCompletions = true;
    plugins = [
      {
        name = "abbreviation-tips";
        src = abbreviationTips;
      }
      {
        name = "plugin-git";
        src = gitPlugin;
      }
    ];
    interactiveShellInit = interactiveInit;
  };

  xdg.configFile."fish/custom" = {
    source = fishSource + "/custom";
    recursive = true;
  };
}
