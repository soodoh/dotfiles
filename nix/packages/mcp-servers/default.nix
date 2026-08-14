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
  configSource = ../../dotfiles/profiles + "/${profile}/.pi/agent/mcp.json";
  config = lib.importJSON configSource;
  package = lib.importJSON (profileSource + "/package.json");
  commands = lib.unique (
    builtins.filter builtins.isString (
      map (server: server.command or null) (builtins.attrValues config.mcpServers)
    )
  );
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

    ${lib.concatMapStringsSep "\n" (command: ''
      test -x "$package_root/node_modules/.bin/${command}"
      makeWrapper "$package_root/node_modules/.bin/${command}" "$out/bin/${command}" \
        --prefix PATH : ${lib.makeBinPath [ nodejs_24 ]}
    '') commands}
    runHook postInstall
  '';

  meta = {
    description = "Pinned ${profile} MCP servers";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
