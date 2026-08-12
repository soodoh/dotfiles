{
  host,
  lib,
  pkgs,
  ...
}:
let
  sharedSource = ../../dotfiles/profiles/common;
  profileSource = ../../dotfiles/profiles/${host.profile};
  skillCatalog = sharedSource + "/.agents/skills";
  skillEntries = builtins.readDir skillCatalog;
  availableSkills = builtins.filter (name: skillEntries.${name} == "directory") (
    builtins.attrNames skillEntries
  );
  personalSkills = [
    "find-skills"
    "grill-me"
    "obsidian-cli"
    "playwright-cli"
    "skill-creator"
    "thermo-nuclear-code-quality-review"
    "vercel-react-best-practices"
  ];
  selectedSkills = if host.profile == "personal" then personalSkills else availableSkills;
  sharedSkillLock = builtins.fromJSON (
    builtins.readFile (sharedSource + "/.agents/.skill-lock.json")
  );
  selectedSkillLock = sharedSkillLock // {
    skills = lib.filterAttrs (name: _skill: builtins.elem name selectedSkills) sharedSkillLock.skills;
  };
  selectedSkillLockFile = pkgs.writeText "${host.profile}-skill-lock.json" (
    builtins.toJSON selectedSkillLock
  );
  agentsSource = pkgs.runCommand "${host.profile}-agents" { } ''
    mkdir -p "$out/skills"
    for skill in ${lib.escapeShellArgs selectedSkills}; do
      cp -R ${skillCatalog}/"$skill" "$out/skills/$skill"
    done
    cp ${selectedSkillLockFile} "$out/.skill-lock.json"
  '';

  sourceFor =
    target:
    let
      profilePath = profileSource + "/${target}";
    in
    if builtins.pathExists profilePath then profilePath else sharedSource + "/${target}";
  mutablePiFiles = [
    {
      source = sourceFor ".pi/agent/settings.json";
      target = ".pi/agent/settings.json";
    }
    {
      source = sourceFor ".pi/agent/mcp.json";
      target = ".pi/agent/mcp.json";
    }
    {
      source = sourceFor ".pi/agent/extensions/pi-openai-fast.json";
      target = ".pi/agent/extensions/pi-openai-fast.json";
    }
    {
      source = sourceFor ".pi/agent/extensions/subagent/config.json";
      target = ".pi/agent/extensions/subagent/config.json";
    }
  ];
  mutablePiTrees = [
    {
      source = sharedSource + "/.pi/workflows";
      target = ".pi/workflows";
    }
    {
      source = profileSource + "/.pi/workflows";
      target = ".pi/workflows";
    }
  ];
  mkImmutableSource =
    source:
    lib.cleanSourceWith {
      src = source;
      filter =
        path: _type:
        let
          pathString = toString path;
          isAgentCatalog = lib.hasSuffix "/.agents" pathString || lib.hasInfix "/.agents/" pathString;
          isMutableFile = lib.any (file: lib.hasSuffix "/${file.target}" pathString) mutablePiFiles;
          isMutableTree = lib.any (
            tree: lib.hasSuffix "/${tree.target}" pathString || lib.hasInfix "/${tree.target}/" pathString
          ) mutablePiTrees;
        in
        !(isAgentCatalog || isMutableFile || isMutableTree);
    };
  immutableSharedSource = mkImmutableSource sharedSource;
  immutableProfileSource = mkImmutableSource profileSource;
  mergedProfileSource = pkgs.runCommand "${host.profile}-agent-profile" { } ''
    mkdir -p "$out"
    cp -R ${immutableSharedSource}/. "$out/"
    chmod -R u+w "$out"
    cp -R ${immutableProfileSource}/. "$out/"
  '';
in
{
  home.file = {
    ".agents" = {
      source = agentsSource;
      recursive = true;
    };
    ".pi/agent" = {
      source = "${mergedProfileSource}/.pi/agent";
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
