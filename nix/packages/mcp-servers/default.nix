{
  buildNpmPackage,
  importNpmLock,
  lib,
  makeWrapper,
  nodejs_24,
  profile,
}:
let
  profileSource = ./. + "/${profile}";
  manifest = lib.importJSON (profileSource + "/package.json");
  commands = manifest.mcpCommands;
  package = removeAttrs manifest [ "mcpCommands" ];
in
buildNpmPackage {
  pname = "${profile}-mcp-servers";
  inherit (package) version;
  src = profileSource;

  npmDeps = importNpmLock {
    inherit package;
    packageLock = lib.importJSON (profileSource + "/package-lock.json");
  };
  inherit (importNpmLock) npmConfigHook;
  dontNpmBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    package_root="$out/lib/${profile}-mcp-servers"
    mkdir -p "$package_root" "$out/bin"
    cp -R node_modules "$package_root/node_modules"

    ${lib.concatStringsSep "\n" (
      lib.mapAttrsToList (command: npmCommand: ''
        test -x "$package_root/node_modules/.bin/${npmCommand}"
        makeWrapper "$package_root/node_modules/.bin/${npmCommand}" "$out/bin/${command}" \
          --prefix PATH : ${lib.makeBinPath [ nodejs_24 ]}
      '') commands
    )}
    runHook postInstall
  '';

  meta = {
    description = "Pinned ${profile} MCP servers";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
