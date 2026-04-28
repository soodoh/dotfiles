return {
  -- Treesitter (LSP-based syntax highlighting)
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    build = ":TSUpdate",
    dependencies = "HiPhish/rainbow-delimiters.nvim",
    config = function()
      local parsers = {
        "caddy",
        "markdown",
        "javascript",
        "typescript",
        "tsx",
        "json",
        "yaml",
        "html",
        "css",
        "lua",
        "bash",
        "dockerfile",
        "gitcommit",
        "toml",
      }

      require("nvim-treesitter").setup({
        install_dir = vim.fn.stdpath("data") .. "/site",
      })

      require("nvim-treesitter").install(parsers)

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
        "<leader>st",
        ":InspectTree<CR>",
        desc = "Inspect AST (Treesitter)",
      },
    }),
  },
}
