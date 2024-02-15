return {
  -- Get github URL to current line
  {
    "ruifm/gitlinker.nvim",
    dependencies = "nvim-lua/plenary.nvim",
    config = function()
      require("gitlinker").setup({
        callbacks = {
          ["github%..+%.com"] = require("gitlinker.hosts").get_github_type_url,
        },
      })
    end,
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
