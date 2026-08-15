{
  buildNpmPackage,
  importNpmLock,
  lib,
  makeWrapper,
  nodejs_24,
}:
let
  source = ./work;
  package = lib.importJSON (source + "/package.json");
  packageLock = lib.importJSON (source + "/package-lock.json");
  commands = lib.unique (
    lib.concatMap (
      dependency: builtins.attrNames (packageLock.packages."node_modules/${dependency}".bin or { })
    ) (builtins.attrNames package.dependencies)
  );
in
buildNpmPackage {
  pname = "work-mcp-servers";
  inherit (package) version;
  src = source;

  npmDeps = importNpmLock { inherit package packageLock; };
  inherit (importNpmLock) npmConfigHook;
  dontNpmBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    package_root="$out/lib/work-mcp-servers"
    mkdir -p "$package_root" "$out/bin"
    cp -R node_modules "$package_root/node_modules"

    ${lib.concatMapStringsSep "\n" (command: ''
      test -x "$package_root/node_modules/.bin/${command}"
      makeWrapper "$package_root/node_modules/.bin/${command}" "$out/bin/${command}" \
        --prefix PATH : ${lib.makeBinPath [ nodejs_24 ]}
    '') commands}
    runHook postInstall
  '';

  meta = {
    description = "Pinned work MCP servers unavailable from nixpkgs";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
