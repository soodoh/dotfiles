{ pkgs }:
rec {
  pi = pkgs.callPackage ./pi { };
  readseek = pkgs.callPackage ./readseek { };
  twg = pkgs.callPackage ./twg { };
  pi-extensions = pkgs.callPackage ./pi-extensions { };
}
