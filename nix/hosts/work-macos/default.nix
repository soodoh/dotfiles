let
  applications = import ../common-darwin-applications.nix {
    extraNixApplications = [ "dotfilesPackages.google-calendar" ];
    extraHomebrewCasks = [ "snowflakedb/snowflake-cli/snowflake-cli" ];
    extraApprovedBundleIds = [ "com.snowflake.snowflake-cli" ];
    extraCleanupProtectedBundleIds = [
      "com.docker.docker"
      "com.figma.Desktop"
      "com.google.Chrome"
      "com.google.drivefs"
      "com.google.drivefs.shortcuts.docs"
      "com.google.drivefs.shortcuts.sheets"
      "com.google.drivefs.shortcuts.slides"
      "com.jamf.selfserviceplus"
      "com.microsoft.VSCode"
      "com.okta.mobile"
      "com.paloaltonetworks.GlobalProtect.client"
      "com.paloaltonetworks.cortex.app"
      "com.postmanlabs.mac"
      "com.tinyspeck.slackmacgap"
      "com.zscaler.installer.uninstall"
      "com.zscaler.zscaler"
      "corp.sap.privileges"
      "io.tailscale.ipn.macos"
      "org.mozilla.firefox"
      "org.videolan.vlc"
      "us.zoom.xos"
    ];
    extraCleanupProtectedHomebrewCasks = [
      "docker-desktop"
      "visual-studio-code"
    ];
    extraCleanupProtectedHomebrewTaps = [ "snowflakedb/snowflake-cli" ];
  };
in
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
  applications = applications // {
    dock = [
      "/Applications/Tailscale.app"
      {
        nixPackage = "ghostty-bin";
        bundle = "Ghostty.app";
      }
      "/Applications/Google Chrome.app"
      "/Applications/Zen.app"
      "/Applications/Slack.app"
      {
        nixPackage = "dotfilesPackages.google-calendar";
        bundle = "Google Calendar.app";
      }
      {
        nixPackage = "obsidian";
        bundle = "Obsidian.app";
      }
      "/System/Applications/Messages.app"
      "/System/Applications/System Settings.app"
      "/Applications/Privileges.app"
    ];
    # Work MDM owns Tailscale installation and startup.
    mas = builtins.removeAttrs applications.mas [ "Tailscale" ];
    masFallbackCasks = { };
    loginItems = builtins.removeAttrs applications.loginItems [ "Tailscale" ];
    approvedBundleIds = builtins.filter (
      id: id != "io.tailscale.ipn.macsys"
    ) applications.approvedBundleIds;
  };
}
