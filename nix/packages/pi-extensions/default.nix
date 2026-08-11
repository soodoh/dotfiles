{
  buildNpmPackage,
  lib,
}:
let
  cleanSource = import ../../lib/clean-source.nix { inherit lib; };
  extensionSource = cleanSource ../../../pi-extensions;
in
buildNpmPackage {
  pname = "pi-extensions";
  version = "0.1.0";
  src = ./.;

  npmDepsHash = "sha256-7R9IGV2M13q00iYBWc2jVdFGcdWtcMg++HknKovTCEM=";
  npmDepsFetcherVersion = 2;
  dontNpmBuild = true;

  installPhase = ''
        runHook preInstall
        package_root="$out/share/pi-extensions"
        mkdir -p "$package_root"
        cp -R ${extensionSource}/. "$package_root/"
        cp -R node_modules "$package_root/node_modules"
        chmod u+w "$package_root/package.json"

        PACKAGE_ROOT="$package_root" node <<'NODE'
        const { readFileSync, writeFileSync } = require("node:fs");
        const packageRoot = process.env.PACKAGE_ROOT;
        const wrapper = JSON.parse(readFileSync("package.json", "utf8"));
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
        runHook postInstall
  '';

  meta = {
    description = "Pinned, dependency-complete Pi extensions from this repository";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
