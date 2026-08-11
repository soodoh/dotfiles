{
  autoPatchelfHook,
  fetchurl,
  lib,
  stdenv,
  stdenvNoCC,
  zlib,
}:
let
  version = "1.1.1";
  sources = {
    aarch64-darwin = {
      artifact = "twg-darwin-arm64-v${version}";
      hash = "sha256-n3z6t1SsdZy1sE7ohmHAziE3VBTsiCg9bW8JjdIKr4M=";
    };
    x86_64-darwin = {
      artifact = "twg-darwin-x64-v${version}";
      hash = "sha256-QDeprOJz6enWHmrSBjsnPebXn1/XsRYJbUhKMOhSKHM=";
    };
    aarch64-linux = {
      artifact = "twg-linux-arm64-v${version}";
      hash = "sha256-jeTVrT/iw1zwO9sHMzlkFptRlp/5+ME7lCSCIsm+C8Q=";
    };
    x86_64-linux = {
      artifact = "twg-linux-x64-v${version}";
      hash = "sha256-ImEE9Ul9+iMF11+fPvwXSsD3dSrXT0yWS3DVfMammhc=";
    };
  };
  source =
    sources.${stdenv.hostPlatform.system}
      or (throw "TWG does not publish an artifact for ${stdenv.hostPlatform.system}");
in
stdenvNoCC.mkDerivation {
  pname = "twg";
  inherit version;

  src = fetchurl {
    url = "https://teamwork-graph.atlassian.com/cli/${source.artifact}";
    inherit (source) hash;
  };
  dontUnpack = true;

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    stdenv.cc.cc.lib
    zlib
  ];

  installPhase = ''
    runHook preInstall
    install -Dm755 "$src" "$out/bin/twg"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    "$out/bin/twg" --version
  '';

  meta = {
    description = "Atlassian Teamwork Graph CLI (setup and authentication remain manual)";
    homepage = "https://teamwork-graph.atlassian.com/cli";
    license = lib.licenses.unfree;
    mainProgram = "twg";
    platforms = builtins.attrNames sources;
  };
}
