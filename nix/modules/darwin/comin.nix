{ host, ... }:
{
  services.comin = {
    enable = true;
    hostname = host.name;
    buildTimeout = 7200;
    remotes = [
      {
        name = "origin";
        url = "https://github.com/soodoh/dotfiles.git";
        branches = {
          main = {
            name = "main";
            operation = "switch";
          };
          testing.name = "";
        };
        poller.period = 300;
      }
    ];
  };
}
