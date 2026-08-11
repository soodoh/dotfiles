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
    };
    masFallbackCasks = {
      Tailscale = "tailscale-app";
    };
    approvedBundleIds = [
      "app.zen-browser.zen"
      "bobko.aerospace"
      "com.electron.wispr-flow"
      "com.google.Chrome"
      "com.mitchellh.ghostty"
      "com.nextcloud.desktopclient"
      "com.pilotmoon.scroll-reverser"
      "com.tinyspeck.slackmacgap"
      "io.tailscale.ipn.macsys"
      "md.obsidian"
      "us.zoom.xos"
    ];
  };
}
