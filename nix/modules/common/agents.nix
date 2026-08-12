{
  host,
  lib,
  pkgs,
  ...
}:
let
  cleanSource = import ../../lib/clean-source.nix { inherit lib; };
  profileSource = cleanSource ../../dotfiles/profiles/${host.profile};
  mutablePiFiles = [
    {
      source = "${profileSource}/.pi/agent/settings.json";
      target = ".pi/agent/settings.json";
    }
    {
      source = "${profileSource}/.pi/agent/mcp.json";
      target = ".pi/agent/mcp.json";
    }
    {
      source = "${profileSource}/.pi/agent/extensions/pi-openai-fast.json";
      target = ".pi/agent/extensions/pi-openai-fast.json";
    }
    {
      source = "${profileSource}/.pi/agent/extensions/subagent/config.json";
      target = ".pi/agent/extensions/subagent/config.json";
    }
  ];
  mutablePiTrees = [
    {
      source = "${profileSource}/.pi/workflows";
      target = ".pi/workflows";
    }
  ];
  immutableProfileSource = lib.cleanSourceWith {
    src = profileSource;
    filter =
      path: _type:
      let
        pathString = toString path;
        isMutableFile = lib.any (file: lib.hasSuffix "/${file.target}" pathString) mutablePiFiles;
        isMutableTree = lib.any (
          tree: lib.hasSuffix "/${tree.target}" pathString || lib.hasInfix "/${tree.target}/" pathString
        ) mutablePiTrees;
      in
      !(isMutableFile || isMutableTree);
  };
in
{
  home.file = {
    ".agents" = {
      source = "${immutableProfileSource}/.agents";
      recursive = true;
    };
    ".pi/agent" = {
      source = "${immutableProfileSource}/.pi/agent";
      recursive = true;
    };
    ".pi/agent/pi-extensions" = {
      source = "${pkgs.dotfilesPackages.pi-extensions}/share/pi-extensions";
    };
  };

  # Pi and its extensions update these files at runtime: core settings, MCP
  # setup, extension preferences, workflow settings/model tiers, and saved
  # workflows. Seed them from the profile instead of linking them into the
  # read-only Nix store. Existing writable files are intentionally preserved.
  home.activation.seedMutablePiConfig = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    seed_mutable_pi_config() {
      source="$1"
      target="$2"

      if [ -L "$target" ]; then
        case "$(readlink "$target")" in
          /nix/store/*) rm -f "$target" ;;
          *) return ;;
        esac
      fi

      if [ ! -e "$target" ]; then
        target_dir="$(dirname "$target")"
        mkdir -p "$target_dir"
        install -m 600 "$source" "$target.tmp"
        mv -f "$target.tmp" "$target"
      fi
    }

    seed_mutable_pi_tree() {
      source_root="$1"
      target_root="$2"

      find "$source_root" -type f -print | while IFS= read -r source_file; do
        relative="''${source_file#"$source_root"/}"
        seed_mutable_pi_config "$source_file" "$target_root/$relative"
      done
    }

    ${lib.concatMapStringsSep "\n" (file: ''
      seed_mutable_pi_config ${lib.escapeShellArg file.source} "$HOME/${file.target}"
    '') mutablePiFiles}

    ${lib.concatMapStringsSep "\n" (tree: ''
      seed_mutable_pi_tree ${lib.escapeShellArg tree.source} "$HOME/${tree.target}"
    '') mutablePiTrees}
  '';
}
