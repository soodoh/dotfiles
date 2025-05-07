return {
  {
    "NeogitOrg/neogit",
    dependencies = {
      "nvim-lua/plenary.nvim", -- required
      "sindrets/diffview.nvim", -- optional - Diff integration

      -- Only one of these is needed.
      "nvim-telescope/telescope.nvim", -- optional
      "ibhagwan/fzf-lua", -- optional
      "echasnovski/mini.pick", -- optional
    },
    config = function()
      local neogit = require("neogit")
      neogit.setup({})
      require("which-key").add({
        {
          "<leader>gg",
          function()
            neogit.open()
          end,
        },
      })
    end,
  },

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
      require("which-key").add({
        { "<leader>g", group = "Git" },
        {
          "<leader>gy",
          function()
            gitlinker.get_buf_range_url("n")
          end,
          desc = "Copy Git URL (Git)",
          mode = "n",
        },
        {
          "<leader>gy",
          function()
            gitlinker.get_buf_range_url("v")
          end,
          desc = "Copy Git URL (Git)",
          mode = "v",
        },
      })
    end,
  },

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

  -- Git conflict
  { "akinsho/git-conflict.nvim", version = "*", config = true },
}
