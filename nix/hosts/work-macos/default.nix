let
  applications = import ../common-darwin-applications.nix {
    extraNixApplications = [ "dotfilesPackages.google-calendar" ];
    extraHomebrewCasks = [ "snowflakedb/snowflake-cli/snowflake-cli" ];
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
    loginItems = builtins.removeAttrs applications.loginItems [ "Tailscale" ];
  };
}
