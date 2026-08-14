{
  buildNpmPackage,
  darwin,
  importNpmLock,
  lib,
  libgit2,
  nodejs_24,
  pi-coding-agent,
  runCommand,
  stdenv,
}:
let
  version = "0.1.0";
  extensionSource = ../../../pi-extensions;
  extensionManifest = lib.importJSON (extensionSource + "/package.json");
  extensionLock = lib.importJSON (extensionSource + "/package-lock.json");
  runtimeManifest = removeAttrs extensionManifest [ "devDependencies" ];
  runtimeLock = extensionLock // {
    packages = lib.filterAttrs (_: package: !(package.dev or false)) extensionLock.packages;
  };
  dependencySource = lib.fileset.toSource {
    root = extensionSource;
    fileset = lib.fileset.unions [
      (extensionSource + "/.npmrc")
      (extensionSource + "/package.json")
      (extensionSource + "/package-lock.json")
    ];
  };
  extensionDependencies = buildNpmPackage {
    pname = "pi-extension-dependencies";
    inherit version;
    src = dependencySource;

    npmDeps = importNpmLock {
      package = runtimeManifest;
      packageLock = runtimeLock;
    };
    inherit (importNpmLock) npmConfigHook;
    npmFlags = [ "--legacy-peer-deps" ];
    npmInstallFlags = [ "--omit=dev" ];
    dontNpmBuild = true;
    nativeBuildInputs = lib.optionals stdenv.hostPlatform.isDarwin [ darwin.cctools ];

    installPhase = ''
      runHook preInstall
      package_root="$out/share/pi-extensions"
      mkdir -p "$package_root"
      cp -R node_modules "$package_root/node_modules"
      test -f "$package_root/node_modules/pi-subagents/index.ts"
      ${lib.optionalString stdenv.hostPlatform.isDarwin ''
        readseek_binary="$package_root/node_modules/@jarkkojs/readseek-darwin-arm64/bin/readseek"
        chmod u+w "$readseek_binary"
        install_name_tool \
          -change /opt/homebrew/opt/libgit2/lib/libgit2.1.9.dylib \
          ${libgit2}/lib/libgit2.1.9.dylib \
          "$readseek_binary"
        /usr/bin/codesign --force --sign - "$readseek_binary"
        /usr/bin/codesign --verify "$readseek_binary"
        otool -L "$readseek_binary" | grep -F '${libgit2}/lib/libgit2.1.9.dylib'
      ''}
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
    dependencies_root=${extensionDependencies}/share/pi-extensions/node_modules
    pi_package_root=${pi-coding-agent}/lib/node_modules/pi-monorepo
    mkdir -p "$package_root/node_modules/@earendil-works"

    for dependency in "$dependencies_root"/* "$dependencies_root"/.[!.]*; do
      [ -e "$dependency" ] || continue
      [ "$(basename "$dependency")" = "@earendil-works" ] && continue
      ln -s "$dependency" "$package_root/node_modules/$(basename "$dependency")"
    done

    for dependency in "$dependencies_root/@earendil-works"/* "$pi_package_root/node_modules/@earendil-works"/*; do
      [ -e "$dependency" ] || continue
      target="$package_root/node_modules/@earendil-works/$(basename "$dependency")"
      [ -e "$target" ] || ln -s "$dependency" "$target"
    done
    ln -s "$pi_package_root" "$package_root/node_modules/@earendil-works/pi-coding-agent"
    chmod u+w "$package_root/package.json"

    PACKAGE_ROOT="$package_root" node <<'NODE'
    const { readFileSync, writeFileSync } = require("node:fs");
    const packageRoot = process.env.PACKAGE_ROOT;
    const manifestPath = packageRoot + "/package.json";
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    for (const packageName of new Set(manifest.bundleDependencies)) {
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
    test -f "$package_root/node_modules/@earendil-works/pi-coding-agent/dist/index.js"
    test -f "$package_root/node_modules/@earendil-works/pi-tui/dist/index.js"
    grep -F 'node_modules/pi-mcp-adapter/index.ts' "$package_root/package.json"
  ''
