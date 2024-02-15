return {
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
