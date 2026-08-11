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
  applications = import ../common-darwin-applications.nix {
    extraNixApplications = [
      "discord"
      "anki-bin"
      "moonlight-qt"
      "rar"
    ];
    extraHomebrewCasks = [ "prusaslicer" ];
    extraMasApplications = {
      HP = 1474276998;
    };
    extraApprovedBundleIds = [
      "com.hnc.Discord"
      "com.hp.SmartMac"
      "com.moonlight-stream.Moonlight"
      "com.prusa3d.slic3r"
      "net.ankiweb.dtop"
    ];
  };
}
