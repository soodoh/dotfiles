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
      require("which-key").register({
        ["<leader>"] = {
          gy = {
            '<cmd>lua require"gitlinker".get_buf_range_url("n", {action_callback = require"gitlinker.actions".open_in_browser})<cr>',
            "Copy Git URL (Git)",
            mode = { "n", "v" },
          },
        },
      })
    end,
  },

  -- Git diff viewer
  {
    "sindrets/diffview.nvim",
    config = function()
      require("diffview").setup()
      require("which-key").register({
        ["<leader>g"] = {
          name = "Git",
          c = { ":tabclose<CR>", "Close (Tab)" },
          d = {
            ":DiffviewOpen HEAD<CR>",
            "All Files Diff from HEAD (Diffview)",
          },
          o = {
            ":DiffviewOpen ",
            "All Files Diff from ... (Diffview)",
            silent = false,
          },
          f = {
            ":DiffviewFileHistory %<CR>",
            "Current File History (Diffview)",
          },
          h = {
            ":DiffviewFileHistory<CR>",
            "All File History (Diffview)",
          },
        },
      })
    end,
  },
}
