{ lib, pkgs, ... }:
let
  cleanSource = import ../../lib/clean-source.nix { inherit lib; };
  neovimSource = cleanSource ../../dotfiles/common/.config/nvim;

  plugin =
    attr: owner: repo: rev:
    if builtins.hasAttr attr pkgs.vimPlugins then
      builtins.getAttr attr pkgs.vimPlugins
    else
      pkgs.vimUtils.buildVimPlugin {
        pname = attr;
        version = builtins.substring 0 12 rev;
        src = builtins.fetchGit {
          url = "https://github.com/${owner}/${repo}.git";
          inherit rev;
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
        (plugin "gitlinker-linrongbin-nvim" "linrongbin16" "gitlinker.nvim"
          "a1b74070bbd5e50128190c85b09f1431ea5fbd83"
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
        (plugin "telescope-live-grep-raw-nvim" "nvim-telescope" "telescope-live-grep-raw.nvim"
          "53e9df55b3651dd7cf77e172f1e8c9a17407acca"
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
      (plugin "vim-rzip" "lbrayner" "vim-rzip" "f65400fed27b27c7cff7ef8d428c4e5ff749bf28")
      which-key-nvim
      yazi-nvim
      # renovate: packageName=Kaiser-Yang/blink-cmp-avante currentValue=master
      (plugin "blink-cmp-avante" "Kaiser-Yang" "blink-cmp-avante"
        "4f494c6e124acbe31a8f5d58effa0c14aa38a6d5"
      )
      # renovate: packageName=MahanRahmati/blink-nerdfont.nvim currentValue=main
      (plugin "blink-nerdfont-nvim" "MahanRahmati" "blink-nerdfont.nvim"
        "e5034457a0a3f3444c0a48af8f5d7db0ad02a204"
      )
      # renovate: packageName=moyiz/blink-emoji.nvim currentValue=master
      (plugin "blink-emoji-nvim" "moyiz" "blink-emoji.nvim" "dff709139ad5389fb55ebab026e75278a12b325a")
      # renovate: packageName=pablopunk/pi.nvim currentValue=main
      (plugin "pi-nvim" "pablopunk" "pi.nvim" "9b619b4f9fb96fa4dc1a6a7776a651980cd819a0")
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
