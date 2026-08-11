{
  name = "work-macos";
  system = "aarch64-darwin";
  username = "paul.diloreto";
  homeDirectory = "/Users/paul.diloreto";
  profile = "work";
  git = {
    name = "Paul DiLoreto";
    email = "paul.diloreto@docusign.com";
  };
  applications = {
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
      "colima"
      "lima"
      "docker"
      "docker-compose"
    ];
    homebrewCasks = [
      "nextcloud"
      "wispr-flow"
      "zen"
    ];
    mas = {
      Tailscale = 1475387142;
      Amphetamine = 937984704;
    };
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
      "com.google.Chrome"
      "com.mitchellh.ghostty"
      "fyi.lunar.Lunar"
      "com.nextcloud.desktopclient"
      "com.pilotmoon.scroll-reverser"
      "com.tinyspeck.slackmacgap"
      "io.tailscale.ipn.macsys"
      "md.obsidian"
      "us.zoom.xos"
    ];
  };
}
