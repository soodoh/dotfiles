return {
  -- Package manager for LSP/DAP/Linters/Formatters
  {
    "williamboman/mason.nvim",
    config = function()
      require("mason").setup()
    end,
  },
  {
    "williamboman/mason-lspconfig.nvim",
    config = function()
      require("mason-lspconfig").setup({
        automatic_installation = true,
      })
    end,
  },

  -- Automatically installs 3rd party tools
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    config = function()
      require("mason-tool-installer").setup({
        ensure_installed = {
          "black",
          "stylua",
          "prettier",
          "prettierd",
          "eslint_d",
        },
        auto_update = true,
      })
    end,
  },
}
