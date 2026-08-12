{ lib, pkgs, ... }:
let
  cleanSource = import ../../lib/clean-source.nix { inherit lib; };
  neovimSource = cleanSource ../../dotfiles/common/.config/nvim;

  pinnedPlugin =
    name: owner: repo: rev: hash:
    pkgs.vimUtils.buildVimPlugin {
      pname = name;
      version = builtins.substring 0 12 rev;
      src = pkgs.fetchFromGitHub {
        inherit
          owner
          repo
          rev
          hash
          ;
      };
    };

  treesitterGrammarNames = [
    "bash"
    "c"
    "css"
    "diff"
    "dockerfile"
    "git_config"
    "git_rebase"
    "gitignore"
    "go"
    "gomod"
    "gosum"
    "graphql"
    "html"
    "javascript"
    "jsdoc"
    "json"
    "jsonc"
    "kdl"
    "lua"
    "luadoc"
    "markdown"
    "markdown_inline"
    "nix"
    "prisma"
    "python"
    "regex"
    "rust"
    "toml"
    "tsx"
    "typescript"
    "vim"
    "vimdoc"
    "yaml"
  ];

  treesitterWithSelectedGrammars = pkgs.vimPlugins.nvim-treesitter.withPlugins (
    grammars:
    map (grammarName: builtins.getAttr grammarName grammars) (
      builtins.filter (grammarName: builtins.hasAttr grammarName grammars) treesitterGrammarNames
    )
  );
in
{
  programs.neovim = {
    enable = true;
    defaultEditor = true;
    viAlias = true;
    vimAlias = true;
    withNodeJs = false;
    withPython3 = false;
    withRuby = false;
    plugins = with pkgs.vimPlugins; [
      comment-nvim
      alpha-nvim
      blink-cmp
      bufferline-nvim
      conform-nvim
      diffview-nvim
      fidget-nvim
      flash-nvim
      friendly-snippets
      git-conflict-nvim
      # renovate: packageName=linrongbin16/gitlinker.nvim currentValue=master
      (
        (pinnedPlugin "gitlinker-linrongbin-nvim" "linrongbin16" "gitlinker.nvim"
          "a1b74070bbd5e50128190c85b09f1431ea5fbd83"
          "sha256-dzo+wrDuWxrv041wgxUZvBpZO4pWbZ/C8zlwEnssyGY="
        ).overrideAttrs
        (_oldAttrs: {
          # The upstream spec helper is test-only and not a loadable plugin module.
          nvimRequireCheck = "gitlinker";
        })
      )
      gitsigns-nvim
      harpoon2
      indent-blankline-nvim
      lspsaga-nvim
      lualine-nvim
      nvim-colorizer-lua
      nvim-lspconfig
      nvim-surround
      treesitterWithSelectedGrammars
      nvim-ts-autotag
      nvim-ufo
      nvim-web-devicons
      plenary-nvim
      promise-async
      rainbow-delimiters-nvim
      snacks-nvim
      telescope-fzf-native-nvim
      # renovate: packageName=nvim-telescope/telescope-live-grep-raw.nvim currentValue=master
      (
        (pinnedPlugin "telescope-live-grep-raw-nvim" "nvim-telescope" "telescope-live-grep-raw.nvim"
          "53e9df55b3651dd7cf77e172f1e8c9a17407acca"
          "sha256-kGGVegympVG4lzJ0zdFjsjiioy0gSQbJuENjll3jNlQ="
        ).overrideAttrs
        (_oldAttrs: {
          # Other modules require telescope.nvim and cannot be loaded in the
          # plugin's isolated require-check environment.
          nvimRequireCheck = [
            "telescope-live-grep-args.prompt_parser"
            "telescope-live-grep-args.helpers"
          ];
        })
      )
      telescope-nvim
      tokyonight-nvim
      trouble-nvim
      # renovate: packageName=lbrayner/vim-rzip currentValue=master
      (pinnedPlugin "vim-rzip" "lbrayner" "vim-rzip" "f65400fed27b27c7cff7ef8d428c4e5ff749bf28"
        "sha256-xy7rNqDVqlGapKClrP5BhfOORlMzHOQ8oIc8FdZT/AE="
      )
      which-key-nvim
      yazi-nvim
      blink-cmp-avante
      blink-nerdfont-nvim
      blink-emoji-nvim
      pi-nvim
    ];
    extraPackages = [
      pkgs.awk-language-server
      pkgs.bash-language-server
      pkgs.biome
      pkgs.docker-language-server
      pkgs.eslint_d
      pkgs.gopls
      pkgs.graphql-language-service-cli
      pkgs.kdlfmt
      pkgs.lua-language-server
      pkgs.marksman
      pkgs.oxlint
      pkgs.prettier
      pkgs.prisma-language-server
      pkgs.pyright
      pkgs.ruff
      pkgs.rust-analyzer
      pkgs.shellcheck
      pkgs.shfmt
      pkgs.stylua
      pkgs.taplo
      pkgs.typescript-language-server
      pkgs.vim-language-server
      pkgs.vscode-langservers-extracted
      pkgs.yaml-language-server
      pkgs.yamllint
    ];
  };

  xdg.configFile.nvim = {
    source = neovimSource;
    recursive = true;
  };
}
