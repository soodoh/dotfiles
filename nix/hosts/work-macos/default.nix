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
  applications = import ../common-darwin-applications.nix {
    extraHomebrewCasks = [ "snowflakedb/snowflake-cli/snowflake-cli" ];
  };
}
