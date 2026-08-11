{
  name = "personal-debian";
  system = "x86_64-linux";
  username = "proxmox";
  homeDirectory = "/home/proxmox";
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
