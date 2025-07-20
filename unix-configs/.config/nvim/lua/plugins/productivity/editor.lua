return {
  -- Hotkeys for surrounding brackets/functions/HTML tags
  {
    "kylechui/nvim-surround",
    version = "*",
    event = "VeryLazy",
    opts = {},
  },

  -- Hotkeys to move in buffer
  {
    "phaazon/hop.nvim",
    branch = "v2", -- optional but strongly recommended
    config = function()
      -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
      require("hop").setup()
      require("which-key").add({
        {
          "s",
          ":HopChar2<CR>",
          desc = "Go to (Hop)",
        },
        {
          "gl",
          ":HopLineStart<CR>",
          desc = "Go to line (Hop)",
        },
      })
    end,
  },

  -- Keep windows open when closing buffer
  {
    "famiu/bufdelete.nvim",
    config = function()
      require("which-key").add({
        { "<leader>d", group = "BufDelete" },
        {
          "<leader>dd",
          ":Bdelete<CR>",
          desc = "Close buffer (keep window open)",
        },
        {
          "<leader>dw",
          ":bd<CR>",
          desc = "Close buffer & window",
        },
      })
    end,
  },
}
