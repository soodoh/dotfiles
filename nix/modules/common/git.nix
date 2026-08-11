{ host, ... }:
{
  programs.git = {
    enable = true;
    settings = {
      user = {
        name = host.git.name;
        email = host.git.email;
      };
      core.excludesFile = "${host.homeDirectory}/.config/.gitignore_global";
      init.defaultBranch = "main";
    };
  };
}
