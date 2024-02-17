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
    branch = "v2",     -- optional but strongly recommended
    config = function()
      -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
      require("hop").setup()
      require("which-key").register({
        s = { ":HopChar2<CR>", "Go to (Hop)" },
        gl = { ":HopLineStart<CR>", "Go to line (Hop)" },
      })
    end,
  },

  -- Keep windows open when closing buffer
  {
    "famiu/bufdelete.nvim",
    config = function()
      require("which-key").register({
        ["<leader>d"] = {
          name = "BufDelete",
          d = {
            ":Bdelete<CR>",
            "Close buffer (keep window open)",
          },
          w = { ":bd<CR>", "Close buffer & window" },
        },
      })
    end,
  },

  -- Automatically enter (){}[] while typing
  {
    "windwp/nvim-autopairs",
    opts = {},
  },
}
