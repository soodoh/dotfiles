return {
  -- Git diff viewer
  {
    "sindrets/diffview.nvim",
    config = function()
      require("diffview").setup()
      require("which-key").add({
        {
          "<leader>gc",
          ":tabclose<CR>",
          desc = "Close (Tab)",
        },
        {
          "<leader>gd",
          ":DiffviewOpen HEAD<CR>",
          desc = "All Files Diff from HEAD (Diffview)",
        },
        {
          "<leader>go",
          ":DiffviewOpen ",
          desc = "All Files Diff from ... (Diffview)",
          silent = false,
        },
        {
          "<leader>gf",
          ":DiffviewFileHistory %<CR>",
          desc = "Current File History (Diffview)",
        },
        {
          "<leader>gh",
          ":DiffviewFileHistory<CR>",
          desc = "All File History (Diffview)",
        },
      })
    end,
  },
}
