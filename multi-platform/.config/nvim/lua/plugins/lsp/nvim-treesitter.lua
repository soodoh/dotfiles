return {
  -- Treesitter (LSP-based syntax highlighting)
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    dependencies = "HiPhish/rainbow-delimiters.nvim",
    config = function()
      -- Treesitter Setup
      local treesitter = require("nvim-treesitter.configs")
      treesitter.setup({
        auto_install = true,
        ensure_installed = { "markdown" },
        highlight = {
          enable = true,        -- false will disable the whole extension
          disable = { "json" }, -- list of language that will be disabled
        },
        indent = { enable = true },
        autopairs = { enable = true },
        autotag = { enable = true },
        context_commentstring = { enable = true },
      })
      -- Rainbow parentheses, powered by treesitter
      local rainbow_delimiters = require("rainbow-delimiters")
      vim.g.rainbow_delimiters = {
        strategy = {
          [""] = rainbow_delimiters.strategy["global"],
          vim = rainbow_delimiters.strategy["local"],
        },
        query = {
          [""] = "rainbow-delimiters",
          lua = "rainbow-blocks",
        },
        highlight = {
          "RainbowDelimiterRed",
          "RainbowDelimiterYellow",
          "RainbowDelimiterBlue",
          "RainbowDelimiterOrange",
          "RainbowDelimiterGreen",
          "RainbowDelimiterViolet",
          "RainbowDelimiterCyan",
        },
      }
    end,
    -- Key bindings
    require("which-key").add({
      {
        "<leader>si",
        ":InspectTree<CR>",
        desc = "Inspect AST (Treesitter)"
      },
    }),
  },
}
