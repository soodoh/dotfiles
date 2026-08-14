{
  config,
  host,
  lib,
  pkgs,
  ...
}:
let
  common = ../../dotfiles/common/.config;
  isDarwin = lib.hasSuffix "-darwin" host.system;
in
{
  xdg.enable = true;

  xdg.configFile = {
    ".gitignore_global".source = "${common}/.gitignore_global";
    "atuin" = {
      source = "${common}/atuin";
      recursive = true;
    };
    "ghostty" = {
      source = "${common}/ghostty";
      recursive = true;
    };
    "lazygit" = {
      source = "${common}/lazygit";
      recursive = true;
    };
    "sesh" = {
      source = "${common}/sesh";
      recursive = true;
    };
    "starship.toml".source = "${common}/starship.toml";
    "tmux" = {
      source = "${common}/tmux";
      recursive = true;
    };
    "yazi" = {
      source = "${common}/yazi";
      recursive = true;
    };
  };

  home.activation.reloadTmuxConfig = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    if ${lib.getExe pkgs.tmux} has-session 2>/dev/null; then
      verboseEcho "Refreshing tmux server environment and configuration"
      server_path="$(${lib.getExe pkgs.tmux} show-environment -g PATH 2>/dev/null || true)"
      server_path="''${server_path#PATH=}"
      if [ -z "$server_path" ]; then
        server_path="$PATH"
      fi
      profile_bin=${lib.escapeShellArg "${config.home.profileDirectory}/bin"}
      case ":$server_path:" in
        *":$profile_bin:"*) ;;
        *) server_path="$profile_bin:$server_path" ;;
      esac
      run ${lib.getExe pkgs.tmux} set-environment -g PATH "$server_path"
      ${lib.optionalString isDarwin ''
        run ${lib.getExe pkgs.tmux} set-environment -g SHELL ${lib.escapeShellArg (lib.getExe pkgs.fish)}
        run ${lib.getExe pkgs.tmux} set-option -g default-shell ${lib.escapeShellArg (lib.getExe pkgs.fish)}
      ''}
      run ${lib.getExe pkgs.tmux} source-file "$HOME/.config/tmux/tmux.conf"
    fi
  '';
}
