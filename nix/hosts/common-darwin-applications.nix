{
  extraNixApplications ? [ ],
  extraHomebrewCasks ? [ ],
  extraMasApplications ? { },
  extraApprovedBundleIds ? [ ],
}:
{
  nix = [
    "ghostty-bin"
    "obsidian"
    "aerospace"
    "sketchybar"
    "jankyborders"
    "scroll-reverser"
    "lunar"
  ]
  ++ extraNixApplications;

  homebrewCasks = [
    "nextcloud"
    "wispr-flow"
    "zen"
  ]
  ++ extraHomebrewCasks;

  mas = {
    Tailscale = 1475387142;
    Amphetamine = 937984704;
  }
  // extraMasApplications;

  masFallbackCasks = {
    Tailscale = "tailscale-app";
  };

  loginItems = {
    AeroSpace = "/Applications/Nix Apps/AeroSpace.app";
    Lunar = "/Applications/Nix Apps/Lunar.app";
    Nextcloud = "/Applications/Nextcloud.app";
    "Scroll Reverser" = "/Applications/Nix Apps/Scroll Reverser.app";
    Tailscale = "/Applications/Tailscale.app";
  };

  approvedBundleIds = [
    "app.zen-browser.zen"
    "bobko.aerospace"
    "com.electron.wispr-flow"
    "com.if.Amphetamine"
    "com.mitchellh.ghostty"
    "fyi.lunar.Lunar"
    "com.nextcloud.desktopclient"
    "com.pilotmoon.scroll-reverser"
    "io.tailscale.ipn.macsys"
    "md.obsidian"
  ]
  ++ extraApprovedBundleIds;
}
