{
  buildNpmPackage,
  lib,
  makeWrapper,
  nodejs_24,
}:
buildNpmPackage rec {
  pname = "pi";
  version = "0.84.1";
  src = ./.;

  npmDepsHash = "sha256-br/7XU8VuVQxUBEsimYKoEw5P05pTHBt4tcj+YOehMc=";
  npmDepsFetcherVersion = 2;
  dontNpmBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/pi" "$out/bin"
    cp -R node_modules "$out/lib/pi/node_modules"
    makeWrapper ${nodejs_24}/bin/node "$out/bin/pi" \
      --add-flags "$out/lib/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    "$out/bin/pi" --version | grep -F "${version}"
  '';

  meta = {
    description = "Terminal coding agent";
    homepage = "https://www.npmjs.com/package/@earendil-works/pi-coding-agent";
    license = lib.licenses.mit;
    mainProgram = "pi";
    platforms = lib.platforms.unix;
  };
}
