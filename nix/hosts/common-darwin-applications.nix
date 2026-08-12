{
  extraNixApplications ? [ ],
  extraHomebrewCasks ? [ ],
  extraMasApplications ? { },
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

  loginItems = {
    AeroSpace = "~/Applications/Home Manager Apps/AeroSpace.app";
    Lunar = "~/Applications/Home Manager Apps/Lunar.app";
    Nextcloud = "/Applications/Nextcloud.app";
    "Scroll Reverser" = "/Applications/Scroll Reverser.app";
    Tailscale = "/Applications/Tailscale.app";
  };

}
