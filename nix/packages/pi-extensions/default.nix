{
  buildNpmPackage,
  lib,
  nodejs_24,
  runCommand,
}:
let
  version = "0.1.0";
  cleanSource = import ../../lib/clean-source.nix { inherit lib; };
  extensionSource = cleanSource ../../../pi-extensions;
  dependencySource = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./package.json
      ./package-lock.json
    ];
  };
  extensionDependencies = buildNpmPackage {
    pname = "pi-extension-dependencies";
    inherit version;
    src = dependencySource;

    npmDepsHash = "sha256-1Lvsq5/vvj7plb9jE33zSbPfzLaFPz5xLxe6gCfy/uk=";
    npmDepsFetcherVersion = 2;
    npmFlags = [ "--legacy-peer-deps" ];
    dontNpmBuild = true;

    installPhase = ''
      runHook preInstall
      package_root="$out/share/pi-extensions"
      mkdir -p "$package_root"
      cp -R node_modules "$package_root/node_modules"
      test -f "$package_root/node_modules/pi-subagents/index.ts"
      runHook postInstall
    '';
  };
in
runCommand "pi-extensions-${version}"
  {
    nativeBuildInputs = [ nodejs_24 ];
    passthru.dependencies = extensionDependencies;
    meta = {
      description = "Pinned, dependency-complete Pi extensions from this repository";
      license = lib.licenses.mit;
      platforms = lib.platforms.unix;
    };
  }
  ''
    package_root="$out/share/pi-extensions"
    mkdir -p "$package_root"
    cp -R ${extensionSource}/. "$package_root/"
    ln -s ${extensionDependencies}/share/pi-extensions/node_modules "$package_root/node_modules"
    chmod u+w "$package_root/package.json"

    PACKAGE_ROOT="$package_root" node <<'NODE'
    const { readFileSync, writeFileSync } = require("node:fs");
    const packageRoot = process.env.PACKAGE_ROOT;
    const wrapper = JSON.parse(readFileSync("${./package.json}", "utf8"));
    const manifestPath = packageRoot + "/package.json";
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    for (const packageName of wrapper.bundledPiPackages) {
      const dependencyRoot = "node_modules/" + packageName;
      const dependencyManifest = JSON.parse(
        readFileSync(packageRoot + "/" + dependencyRoot + "/package.json", "utf8"),
      );
      for (const resourceType of ["extensions", "skills", "prompts", "themes"]) {
        const resources = dependencyManifest.pi?.[resourceType] ?? [];
        manifest.pi[resourceType] ??= [];
        manifest.pi[resourceType].push(
          ...resources.map(
            (resource) => dependencyRoot + "/" + resource.replace(/^\.\//, ""),
          ),
        );
      }
    }

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    NODE

    test -f "$package_root/packages/statusline/index.ts"
    test -f "$package_root/node_modules/pi-subagents/index.ts"
    grep -F 'node_modules/pi-mcp-adapter/index.ts' "$package_root/package.json"
  ''
