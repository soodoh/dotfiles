{
  extraNixApplications ? [ ],
  extraHomebrewCasks ? [ ],
  extraMasApplications ? { },
}:
{
  nix = [
    "ghostty-bin"
    "obsidian"
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

  loginItems = {
    Lunar = "~/Applications/Home Manager Apps/Lunar.app";
    Nextcloud = "/Applications/Nextcloud.app";
    Tailscale = "/Applications/Tailscale.app";
  };

}
