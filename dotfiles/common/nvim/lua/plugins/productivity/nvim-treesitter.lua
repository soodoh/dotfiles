local parsers = require("treesitter-parsers")

return {
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    lazy = false,
    build = function()
      require("nvim-treesitter").install(parsers):wait(300000)
    end,
    dependencies = "HiPhish/rainbow-delimiters.nvim",
    config = function()
      require("nvim-treesitter").setup({})
      -- jsonc shares the JSON grammar in current nvim-treesitter.
      vim.treesitter.language.register("json", "jsonc")

      vim.api.nvim_create_autocmd("FileType", {
        group = vim.api.nvim_create_augroup("treesitter_features", {
          clear = true,
        }),
        pattern = "*",
        callback = function(event)
          pcall(vim.treesitter.start, event.buf)
          vim.wo[0][0].foldexpr = "v:lua.vim.treesitter.foldexpr()"
          vim.wo[0][0].foldmethod = "expr"
          vim.bo[event.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
        end,
      })

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

      require("which-key").add({
        {
          "<leader>st",
          ":InspectTree<CR>",
          desc = "Inspect AST (Treesitter)",
        },
      })
    end,
  },
}
