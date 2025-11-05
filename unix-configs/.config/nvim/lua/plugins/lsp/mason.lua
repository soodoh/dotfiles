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
        automatic_enable = true,
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
          "csharp-language-server",
          "css-lsp",
          "docker-language-server",
          "eslint-lsp",
          "gopls",
          "html-lsp",
          "json-lsp",
          "lua-language-server",
          "marksman",
          "prisma-language-server",
          "pyright",
          "rust-analyzer",
          "taplo",
          "typescript-language-server",
          "vim-language-server",
          "yaml-language-server",

          -- Formatters
          "black",
          "eslint_d",
          "kdlfmt",
          "prettier",
          "shellcheck",
          "shfmt",
          "stylua",
        },
        auto_update = true,
      })
    end,
  },
}
