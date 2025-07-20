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
}
