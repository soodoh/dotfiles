return {
  -- Color theme
  {
    "marko-cerovac/material.nvim",
    init = function()
      vim.o.background = "dark"
      vim.g.material_style = "deep ocean"
      vim.cmd("colorscheme material")
    end,
    opts = {
      contrast = {
        terminal = true,
        sidebars = false,
        floating_windows = false,
        cursor_line = true,
        non_current_windows = true,
      },
      plugins = {
        "dashboard",
        "gitsigns",
        "hop",
        "indent-blankline",
        "lspsaga",
        "nvim-cmp",
        "nvim-tree",
        "nvim-web-devicons",
        "telescope",
        "trouble",
      },
    },
  },

  -- Smooth scrolling
  {
    "karb94/neoscroll.nvim",
    opts = {
      hide_cursor = true,
      respect_scrolloff = true,
      cursor_scrolls_alone = true,
      performance_mode = true,
    },
  },

  -- Status Line
  -- {
  --   "nvim-lualine/lualine.nvim",
  --   dependencies = { "nvim-tree/nvim-web-devicons" },
  --   opts = {},
  -- },

  -- Color hex codes
  {
    "norcalli/nvim-colorizer.lua",
    opts = {
      "*",
      css = { css = true },
    },
  },
}
