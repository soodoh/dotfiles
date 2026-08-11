{
  name = "personal-arch";
  system = "x86_64-linux";
  username = "docker";
  homeDirectory = "/home/docker";
  profile = "personal";
  git = {
    name = "Paul DiLoreto";
    email = "soodohh@pm.me";
  };
  applications = {
    nix = [ ];
    homebrewCasks = [ ];
    mas = { };
  };
}
