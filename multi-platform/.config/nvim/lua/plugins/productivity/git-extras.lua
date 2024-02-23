return {
  -- Get github URL to current line
  {
    "ruifm/gitlinker.nvim",
    dependencies = "nvim-lua/plenary.nvim",
    config = function()
      local gitlinker = require("gitlinker")
      gitlinker.setup({
        opts = {
          add_current_line_on_normal_mode = true,
          action_callback = require("gitlinker.actions").copy_to_cliboard,
          print_url = true,
        },
        callbacks = {
          ["github%..+%.com"] = require("gitlinker.hosts").get_github_type_url,
        },
      })
      local wk = require("which-key")
      -- Normal mode key bindings
      wk.register({
        ["<leader>g"] = {
          name = "Git",
          y = {
            function()
              gitlinker.get_buf_range_url("n")
            end,
            "Copy Git URL (Git)",
          },
        },
      }, { mode = "n" })
      -- Visual mode key bindings
      wk.register({
        ["<leader>g"] = {
          name = "Git",           -- So that group is named in visual mode too
          y = {
            function()
              gitlinker.get_buf_range_url("v")
            end,
            "Copy Git URL (Git)",
          },
        },
      }, { mode = "v" })
    end,
  },

  -- Git diff viewer
  {
    "sindrets/diffview.nvim",
    config = function()
      require("diffview").setup()
      require("which-key").register({
        ["<leader>g"] = {
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
