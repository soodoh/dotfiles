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
  applications =
    (import ../common-darwin-applications.nix {
      extraNixApplications = [
        "discord"
        "anki-bin"
        "moonlight-qt"
        "rar"
        "google-chrome"
        "slack"
        "zoom-us"
      ];
      extraHomebrewCasks = [ "prusaslicer" ];
      extraMasApplications = {
        HP = 1474276998;
      };
    })
    // {
      dock = [
        "/Applications/Tailscale.app"
        {
          nixPackage = "ghostty-bin";
          bundle = "Ghostty.app";
        }
        "/Applications/Zen.app"
        {
          nixPackage = "obsidian";
          bundle = "Obsidian.app";
        }
        "/System/Applications/Messages.app"
        {
          nixPackage = "moonlight-qt";
          bundle = "Moonlight.app";
        }
        "/Applications/PrusaSlicer.app"
        "/System/Applications/System Settings.app"
      ];
    };
}
