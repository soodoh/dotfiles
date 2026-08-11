{
  name = "personal-macos";
  system = "aarch64-darwin";
  username = "pauldiloreto";
  homeDirectory = "/Users/pauldiloreto";
  profile = "personal";
  git = {
    name = "Paul DiLoreto";
    email = "soodohh@pm.me";
  };
  applications = {
    nix = [
      "ghostty-bin"
      "google-chrome"
      "obsidian"
      "discord"
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
      "anki-bin"
      "moonlight-qt"
      "rar"
    ];
    homebrewCasks = [
      "nextcloud"
      "prusaslicer"
      "wispr-flow"
      "zen"
    ];
    mas = {
      Tailscale = 1475387142;
      Amphetamine = 937984704;
      HP = 1474276998;
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
      "com.google.Chrome"
      "com.hnc.Discord"
      "com.hp.SmartMac"
      "com.if.Amphetamine"
      "com.mitchellh.ghostty"
      "fyi.lunar.Lunar"
      "com.moonlight-stream.Moonlight"
      "com.nextcloud.desktopclient"
      "com.pilotmoon.scroll-reverser"
      "com.prusa3d.slic3r"
      "com.tinyspeck.slackmacgap"
      "io.tailscale.ipn.macsys"
      "md.obsidian"
      "net.ankiweb.dtop"
      "us.zoom.xos"
    ];
  };
}
