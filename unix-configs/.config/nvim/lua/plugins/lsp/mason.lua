return {
  -- Package manager for LSP/DAP/Linters/Formatters
  {
    "mason-org/mason.nvim",
    config = function()
      require("mason").setup()
    end,
  },
  {
    "mason-org/mason-lspconfig.nvim",
    config = function()
      require("mason-lspconfig").setup({
        automatic_enable = {
          exclude = { "stylua" },
        },
      })
    end,
  },

  -- Automatically installs 3rd party tools
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    config = function()
      require("mason-tool-installer").setup({
        ensure_installed = {
          -- LSP
          "awk-language-server",
          "bash-language-server",
          "css-lsp",
          "docker-language-server",
          "biome",
          "eslint-lsp",
          "gopls",
          "html-lsp",
          "json-lsp",
          "lua-language-server",
          "marksman",
          "oxlint",
          "prisma-language-server",
          "pyright",
          "ruff",
          "rust-analyzer",
          "taplo",
          "typescript-language-server",
          "vim-language-server",
          "yaml-language-server",

          -- Linters
          "yamllint",

          -- Formatters
          "eslint_d",
          "kdlfmt",
          "prettier",
          "shellcheck",
          "shfmt",
          "stylua",
        },
        auto_update = true,
        debounce_hours = 24,
      })
    end,
  },
}
