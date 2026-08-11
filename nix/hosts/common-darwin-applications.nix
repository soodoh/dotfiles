{
  extraNixApplications ? [ ],
  extraHomebrewCasks ? [ ],
  extraMasApplications ? { },
  extraApprovedBundleIds ? [ ],
}:
{
  nix = [
    "ghostty-bin"
    "google-chrome"
    "obsidian"
    "slack"
    "zoom-us"
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
    "com.google.Chrome"
    "com.if.Amphetamine"
    "com.mitchellh.ghostty"
    "fyi.lunar.Lunar"
    "com.nextcloud.desktopclient"
    "com.pilotmoon.scroll-reverser"
    "com.tinyspeck.slackmacgap"
    "io.tailscale.ipn.macsys"
    "md.obsidian"
    "us.zoom.xos"
  ]
  ++ extraApprovedBundleIds;
}
