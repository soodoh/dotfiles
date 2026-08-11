{
  config,
  host,
  lib,
  pkgs,
  ...
}:
let
  cleanSource = import ../../lib/clean-source.nix { inherit lib; };
  common = cleanSource ../../dotfiles/common/.config;
  darwin = cleanSource ../../dotfiles/darwin/.config;
  isDarwin = lib.hasSuffix "-darwin" host.system;
  managedDirectories = [
    ".agents"
    ".config/atuin"
    ".config/fish"
    ".config/ghostty"
    ".config/lazygit"
    ".config/nvim"
    ".config/sesh"
    ".config/tmux"
    ".config/yazi"
    ".pi/agent"
    ".pi/agent/extensions"
    ".pi/agent/pi-extensions"
    ".pi/workflows"
    ".pi/workflows/saved"
  ]
  ++ lib.optionals (lib.hasSuffix "-darwin" host.system) [
    ".config/aerospace"
    ".config/sketchybar"
  ];
in
{
  xdg.enable = true;

  # Recursive Home Manager targets can otherwise traverse a Stow directory
  # symlink and replace files inside the source repository. Fail before writes
  # until the operator has moved legacy links aside and created real parents.
  home.activation.guardLegacyDirectoryLinks = lib.hm.dag.entryBefore [ "checkLinkTargets" ] ''
    blocked=0
    for relative in ${lib.escapeShellArgs managedDirectories}; do
      path="$HOME/$relative"
      if [ -L "$path" ]; then
        target="$(readlink "$path")"
        case "$target" in
          /nix/store/*) continue ;;
        esac
        echo >&2 "legacy directory symlink blocks Home Manager activation: $path -> $target"
        blocked=1
      fi
    done
    if [ "$blocked" -ne 0 ]; then
      echo >&2 "Move each listed link to <path>.before-nix-home-manager, create a real directory at <path>, preserve local secrets, then switch again."
      exit 1
    fi
  '';

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
  }
  // lib.optionalAttrs (lib.hasSuffix "-darwin" host.system) {
    "aerospace" = {
      source = "${darwin}/aerospace";
      recursive = true;
    };
    "sketchybar" = {
      source = "${darwin}/sketchybar";
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
