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

  -- Git diff viewer
  {
    "sindrets/diffview.nvim",
    config = function()
      require("diffview").setup()
      vim.keymap.set(
        "n",
        "<leader>gc",
        ":tabclose<CR>",
        { silent = true }
      )
      -- Current file
      vim.keymap.set("n", "<leader>gd", ":DiffviewOpen HEAD<CR>")
      vim.keymap.set("n", "<leader>gf", ":DiffviewFileHistory %<CR>")
      -- Extras
      vim.keymap.set("n", "<leader>go", ":DiffviewOpen ")
      vim.keymap.set("n", "<leader>gh", ":DiffviewFileHistory<CR>")
    end,
  },
}
