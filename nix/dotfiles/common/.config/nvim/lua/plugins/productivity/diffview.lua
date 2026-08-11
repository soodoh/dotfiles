return {
  -- Git diff viewer
  {
    "sindrets/diffview.nvim",
    cmd = {
      "DiffviewClose",
      "DiffviewFileHistory",
      "DiffviewFocusFiles",
      "DiffviewOpen",
      "DiffviewRefresh",
      "DiffviewToggleFiles",
    },
    keys = {
      {
        "<leader>gc",
        "<cmd>tabclose<CR>",
        desc = "Close (Tab)",
      },
      {
        "<leader>gd",
        "<cmd>DiffviewOpen HEAD<CR>",
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
        "<cmd>DiffviewFileHistory %<CR>",
        desc = "Current File History (Diffview)",
      },
      {
        "<leader>gh",
        "<cmd>DiffviewFileHistory<CR>",
        desc = "All File History (Diffview)",
      },
    },
    config = function()
      require("diffview").setup()
    end,
  },
}
