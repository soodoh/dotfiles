{ lib }:
source:
lib.cleanSourceWith {
  src = source;
  filter =
    path: type:
    let
      name = baseNameOf (toString path);
      ignoredNames = [
        ".DS_Store"
        ".git"
        ".pi-subagents"
        ".twg-install.json"
        ".worktrees"
        "__pycache__"
        "coverage"
        "dist"
        "evals"
        "node_modules"
      ];
      ignoredSuffixes = [
        ".log"
        ".pid"
        ".pyc"
      ];
      generated =
        lib.hasPrefix "fish_variables" name
        || lib.hasPrefix "iteration-" name
        || lib.any (suffix: lib.hasSuffix suffix name) ignoredSuffixes;
    in
    !(lib.elem name ignoredNames || generated)
    && (type != "symlink" || !lib.hasInfix "node_modules" (toString path));
}
