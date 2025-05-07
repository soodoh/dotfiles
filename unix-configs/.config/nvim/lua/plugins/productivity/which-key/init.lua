return {
  -- Displays popup with possible key bindings of the command being typed
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    init = function()
      vim.o.timeout = true
      vim.o.timeoutlen = 300
    end,
    opts = {
      plugins = {
        marks = true,
        registers = true,
        spelling = {
          enabled = true,
          suggestions = 20,
        },
        presets = {
          operators = true, -- help for operators (d, y, ...)
          motions = true,
          text_objects = true,
          windows = true, -- help for <C-w>
          nav = true,     -- misc bindings to work with windows
          z = true,       -- bindings for folds
          g = true,       -- bindings for "g" prefix
        },
      },
      -- disable which-key for the following
      disable = {
        buftypes = {},
        filetypes = {},
      },
    },
    config = require("plugins.productivity.which-key.mappings"),
  },
}
