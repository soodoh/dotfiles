{ pkgs }:
{
  twg = pkgs.callPackage ./twg { };
  pi-extensions = pkgs.callPackage ./pi-extensions { };
}
// pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
  google-calendar = pkgs.callPackage ./google-calendar { };
}
