{ host, lib, ... }:
let
  cleanSource = import ../../lib/clean-source.nix { inherit lib; };
  common = cleanSource ../../dotfiles/common/.config;
  darwin = cleanSource ../../dotfiles/darwin/.config;
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
        echo >&2 "legacy directory symlink blocks Home Manager activation: $path -> $(readlink "$path")"
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
}
