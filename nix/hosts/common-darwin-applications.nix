{
  extraNixApplications ? [ ],
  extraHomebrewCasks ? [ ],
  extraMasApplications ? { },
  extraApprovedBundleIds ? [ ],
  extraCleanupProtectedBundleIds ? [ ],
  extraCleanupProtectedHomebrewCasks ? [ ],
  extraCleanupProtectedHomebrewTaps ? [ ],
}:
{
  nix = [
    "ghostty-bin"
    "obsidian"
    "aerospace"
    "sketchybar"
    "jankyborders"
    "lunar"
  ]
  ++ extraNixApplications;

  homebrewCasks = [
    "nextcloud"
    "scroll-reverser"
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
    "Scroll Reverser" = "/Applications/Scroll Reverser.app";
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

  # These remain owned by corporate management or the operator. Cleanup must
  # ignore them without making nix-darwin responsible for installation.
  cleanupProtected = {
    bundleIds = extraCleanupProtectedBundleIds;
    homebrewCasks = extraCleanupProtectedHomebrewCasks;
    homebrewTaps = [
      "homebrew/core"
      "homebrew/cask"
    ]
    ++ extraCleanupProtectedHomebrewTaps;
  };
}
