return {
  -- Displays popup with possible key bindings of the command being typed
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    init = function()
      vim.o.timeout = true
      vim.o.timeoutlen = 300
    end,
    opts = {},
  },

  -- Hotkeys for surrounding brackets/functions/HTML tags
  {
    "kylechui/nvim-surround",
    version = "*",
    event = "VeryLazy",
    config = function()
      require("nvim-surround").setup()
    end,
  },

  -- Hotkeys to move in buffer
  {
    "phaazon/hop.nvim",
    branch = "v2",     -- optional but strongly recommended
    config = function()
      -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
      require("hop").setup()
      vim.keymap.set("n", "s", ":HopChar2<CR>")
      vim.keymap.set("n", "gl", ":HopLineStart<CR>")
    end,
  },

  -- Keep windows open when closing buffer
  {
    "famiu/bufdelete.nvim",
    config = function()
      vim.keymap.set(
        "n",
        "<leader>d",
        ":Bdelete<CR>",
        { silent = true }
      )
      vim.keymap.set("n", "<leader>w", ":bd<CR>", { silent = true })
    end,
  },

  -- Automatically enter (){}[] while typing
  {
    "windwp/nvim-autopairs",
    config = function()
      require("nvim-autopairs").setup()
    end,
  },
}
