{
  lib,
  stdenvNoCC,
  fetchurl,
  makeBinaryWrapper,
  nodejs-slim,
  tsgolint,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "oxlint";
  version = "1.77.0";

  cli = fetchurl {
    url = "https://registry.npmjs.org/oxlint/-/oxlint-${finalAttrs.version}.tgz";
    hash = "sha256-97WmSgnJfpiF1y0eUfR1/92ZfVDe+VzMml4FquAsqW8=";
  };

  binding = fetchurl {
    url = "https://registry.npmjs.org/@oxlint/binding-darwin-arm64/-/binding-darwin-arm64-${finalAttrs.version}.tgz";
    hash = "sha256-KPzLbQCzSTxGAE+ixEWyN72tResA18gBgv48eVSL1O8=";
  };

  dontUnpack = true;
  strictDeps = true;

  nativeBuildInputs = [ makeBinaryWrapper ];

  installPhase = ''
    runHook preInstall

    packageRoot="$out/lib/oxlint"
    bindingRoot="$packageRoot/node_modules/@oxlint/binding-darwin-arm64"

    mkdir -p "$packageRoot" "$bindingRoot" "$out/bin"
    tar -xzf "$cli" --strip-components=1 -C "$packageRoot"
    tar -xzf "$binding" --strip-components=1 -C "$bindingRoot"
    chmod +x "$packageRoot/bin/oxlint"

    makeBinaryWrapper "${lib.getExe nodejs-slim}" "$out/bin/oxlint" \
      --add-flags "$packageRoot/bin/oxlint" \
      --prefix PATH : "${lib.makeBinPath [ tsgolint ]}"

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck

    test "$($out/bin/oxlint --version)" = "Version: ${finalAttrs.version}"

    pluginTestDir="$(mktemp -d)"
    cat > "$pluginTestDir/plugin.mjs" <<'EOF'
    const plugin = {
      meta: { name: "smoke-plugin" },
      rules: {
        "always-error": {
          create(context) {
            return {
              Program(node) {
                context.report({ node, message: "plugin-smoke-ok" });
              },
            };
          },
        },
      },
    };
    export default plugin;
    EOF
    cat > "$pluginTestDir/.oxlintrc.jsonc" <<'EOF'
    {
      "jsPlugins": ["./plugin.mjs"],
      "rules": {
        "smoke-plugin/always-error": "error"
      }
    }
    EOF
    printf 'const value = 1;\n' > "$pluginTestDir/input.js"

    set +e
    pluginOutput="$(cd "$pluginTestDir" && $out/bin/oxlint input.js 2>&1)"
    pluginStatus=$?
    set -e
    test "$pluginStatus" -ne 0
    printf '%s\n' "$pluginOutput" | grep -F "plugin-smoke-ok" > /dev/null

    typeAwareTestDir="$(mktemp -d)"
    cat > "$typeAwareTestDir/.oxlintrc.jsonc" <<'EOF'
    {
      "rules": {
        "typescript/no-unnecessary-type-assertion": "error"
      }
    }
    EOF
    cat > "$typeAwareTestDir/tsconfig.json" <<'EOF'
    {
      "compilerOptions": {
        "target": "es2024",
        "lib": ["ES2024", "DOM"],
        "module": "es2022",
        "strict": true,
        "skipLibCheck": true
      }
    }
    EOF
    cat > "$typeAwareTestDir/input.ts" <<'EOF'
    const str: string = "hello";
    const redundant = str as string;

    export {};
    EOF

    set +e
    typeAwareOutput="$(cd "$typeAwareTestDir" && $out/bin/oxlint --type-aware input.ts 2>&1)"
    typeAwareStatus=$?
    set -e
    test "$typeAwareStatus" -ne 0
    printf '%s\n' "$typeAwareOutput" | grep -F "no-unnecessary-type-assertion" > /dev/null

    runHook postInstallCheck
  '';

  meta = {
    description = "Collection of JavaScript tools written in Rust";
    homepage = "https://oxc.rs";
    changelog = "https://github.com/oxc-project/oxc/releases/tag/oxlint_v${finalAttrs.version}";
    license = lib.licenses.mit;
    mainProgram = "oxlint";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
  };
})
