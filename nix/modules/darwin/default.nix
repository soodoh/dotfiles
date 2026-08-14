{
  allowUnfreePredicate,
  host,
  inputs,
  lib,
  pkgs,
  ...
}:
{
  imports = [
    ./applications.nix
    ./comin.nix
    ./homebrew.nix
    ./login-items.nix
    ./defaults.nix
    ./window-management.nix
    ./containers.nix
    ./work-corporate.nix
  ];

  nixpkgs = {
    hostPlatform = host.system;
    overlays = [
      inputs.self.overlays.default
    ];
    config.allowUnfreePredicate = allowUnfreePredicate;
  };

  nix = {
    enable = true;
    settings = {
      experimental-features = [
        "nix-command"
        "flakes"
      ];
      substituters = [ "https://nix-community.cachix.org" ];
      trusted-public-keys = [
        "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
      ];
      builders-use-substitutes = true;
      max-jobs = "auto";
      cores = 0;
      auto-optimise-store = true;
      warn-dirty = false;
    };
    optimise.automatic = true;
    gc = {
      automatic = true;
      interval = {
        Weekday = 0;
        Hour = 4;
        Minute = 15;
      };
      options = "--delete-older-than 30d";
    };
  };

  system = {
    primaryUser = host.username;
    configurationRevision = inputs.self.rev or inputs.self.dirtyRev or null;
    stateVersion = 6;
  };

  users.users.${host.username} = {
    home = host.homeDirectory;
    shell = pkgs.fish;
  };
  environment.shells = [ pkgs.fish ];
  programs = {
    fish.enable = true;
    mas = {
      enable = true;
      packages = host.applications.mas;
      update = false;
    };
  };

  # users.users describes the existing admin account to Home Manager, but recent
  # nix-darwin releases intentionally do not manage admin users through
  # users.knownUsers. Keep only the login-shell property declarative so new
  # terminals use the Nix-managed Fish and its system environment.
  system.activationScripts.postActivation.text = ''
    desired_shell="/run/current-system/sw/bin/fish"
    current_shell="$(/usr/bin/dscl . -read /Users/${host.username} UserShell 2>/dev/null || true)"
    current_shell="''${current_shell#UserShell: }"
    if [ "$current_shell" != "$desired_shell" ]; then
      echo >&2 "setting ${host.username}'s login shell to $desired_shell..."
      /usr/bin/dscl . -create /Users/${host.username} UserShell "$desired_shell"
    fi
  '';

  # No custom sudo PAM rules are required; leave the SIP-managed directory to macOS.
  security.pam.services.sudo_local.enable = false;

  environment.systemPackages = [ pkgs.trash-cli ];
  fonts.packages = [ pkgs.nerd-fonts.fira-code ];

  home-manager = {
    useGlobalPkgs = true;
    useUserPackages = true;
    backupFileExtension = "hm-backup";
    extraSpecialArgs = { inherit host inputs; };
    users.${host.username}.imports = [
      ../common
      ../profiles/${host.profile}.nix
      {
        home = {
          inherit (host) username homeDirectory;
          stateVersion = "25.11";
        };
        programs.home-manager.enable = true;
      }
    ];
  };

  assertions = [
    {
      assertion = lib.hasSuffix "-darwin" host.system;
      message = "nix-darwin hosts must declare a Darwin system.";
    }
  ];
}
