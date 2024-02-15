return {
  -- Package manager for LSP/DAP/Linters/Formatters
  {
    "williamboman/mason.nvim",
    build = ":MasonUpdate",
    config = function()
      require("mason").setup({
        ui = {
          border = "rounded",
        },
      })
    end,
  },

  -- Closes gaps between mason.nvim & lspconfig
  {
    "williamboman/mason-lspconfig.nvim",
    after = "williamboman/mason.nvim",
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
        },
        auto_update = true,
      })
    end,
  },
}
