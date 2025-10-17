return {
  {
    "nvim-lualine/lualine.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = function()
      local colors = {
        blue = "#80a0ff",
        cyan = "#79dac8",
        white = "#c6c6c6",
        red = "#ff5189",
        purple = "#d183e8",
        grey = "#303030",
      }

      local bubbles_theme = {
        normal = {
          a = { fg = "black", bg = colors.purple },
          b = { fg = colors.white, bg = colors.grey },
          c = { fg = colors.white },
        },
        insert = { a = { fg = "black", bg = colors.blue } },
        visual = { a = { fg = "black", bg = colors.cyan } },
        replace = { a = { fg = "black", bg = colors.red } },
        inactive = {
          a = { fg = colors.white, bg = "black" },
          b = { fg = colors.white, bg = "black" },
          c = { fg = colors.white },
        },
      }

      require("lualine").setup({
        options = {
          theme = bubbles_theme,
          component_separators = "",
          section_separators = { left = "", right = "" },
        },
      })
    end,
  },
}
