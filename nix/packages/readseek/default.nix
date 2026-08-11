{
  buildNpmPackage,
  lib,
  libgit2,
  makeWrapper,
  nodejs_24,
}:
buildNpmPackage rec {
  pname = "readseek";
  version = "0.9.10";
  src = ./.;

  npmDepsHash = "sha256-7y9rNMW4I2LMbyrBBMmPp8yXqLbFObvCDXb9BSRTPFM=";
  npmDepsFetcherVersion = 2;
  dontNpmBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/readseek" "$out/bin"
    cp -R node_modules "$out/lib/readseek/node_modules"
    makeWrapper ${nodejs_24}/bin/node "$out/bin/readseek" \
      --add-flags "$out/lib/readseek/node_modules/@jarkkojs/readseek/bin/readseek.js" \
      --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath [ libgit2 ]}" \
      --prefix DYLD_LIBRARY_PATH : "${lib.makeLibraryPath [ libgit2 ]}"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    "$out/bin/readseek" --version | grep -F "${version}"
  '';

  meta = {
    description = "Structural code navigation and editing CLI";
    homepage = "https://www.npmjs.com/package/@jarkkojs/readseek";
    license = lib.licenses.mit;
    mainProgram = "readseek";
    platforms = lib.platforms.unix;
  };
}
