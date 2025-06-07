return {
  -- Color theme
  {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000,
    config = function()
      require("catppuccin").setup({
        color_overrides = {
          mocha = {
            base = "#000000",
            mantle = "#000000",
            crust = "#000000",
          },
        },
        integrations = {
          bufferline = true,
          fzf = true,
          gitsigns = true,
          hop = true,
          indent_blankline = {
            enabled = true,
            scope_color = "", -- catppuccin color (eg. `lavender`) Default: text
            colored_indent_levels = false,
          },
          lsp_saga = true,
          mason = true,
          neogit = true,
          nvim_surround = true,
          nvimtree = true,
          treesitter_context = true,
          treesitter = true,
          ts_rainbow = true,
          ufo = true,
          telescope = {
            enabled = true,
            -- style = "nvchad"
          },
          lsp_trouble = true,
          which_key = true,
        },
      })
      vim.cmd.colorscheme("catppuccin-mocha")
    end,
  },

  -- Status Line
  {
    "nvim-lualine/lualine.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = function()
      require("lualine").setup({
        options = {
          theme = "catppuccin",
        },
      })
    end,
  },

  -- Color hex codes
  {
    "norcalli/nvim-colorizer.lua",
    opts = {
      "*",
      css = { css = true },
    },
  },
}
