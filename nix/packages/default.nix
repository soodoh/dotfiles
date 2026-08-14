{ pkgs }:
{
  mcp-servers-personal = pkgs.callPackage ./mcp-servers { profile = "personal"; };
  twg = pkgs.callPackage ./twg { };
  pi-extensions = pkgs.callPackage ./pi-extensions { };
}
// pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
  google-calendar = pkgs.callPackage ./google-calendar { };
  oxlint-npm = pkgs.callPackage ./oxlint-npm { };
  mcp-servers-work = pkgs.callPackage ./mcp-servers { profile = "work"; };
}
