return {
  -- Color theme
  {
    "baliestri/aura-theme",
    lazy = false,
    priority = 1000,
    config = function(plugin)
      vim.opt.rtp:append(plugin.dir .. "/packages/neovim")
      vim.cmd([[colorscheme aura-dark]])
    end,
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
  {
    "nvim-lualine/lualine.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    opts = {},
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
