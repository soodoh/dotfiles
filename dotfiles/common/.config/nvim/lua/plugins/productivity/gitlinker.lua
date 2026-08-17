return {
  -- Get github URL to current line
  {
    "linrongbin16/gitlinker.nvim",
    commit = "a1b74070bbd5e50128190c85b09f1431ea5fbd83",
    cmd = "GitLink",
    keys = {
      {
        "<leader>gy",
        "<cmd>GitLink<cr>",
        desc = "Copy Git URL (Git)",
        mode = { "n", "v" },
      },
    },
    opts = function()
      local routers = require("gitlinker.routers")

      return {
        router = {
          browse = {
            ["^github%..+%.com"] = routers.github_browse,
          },
          blame = {
            ["^github%..+%.com"] = routers.github_blame,
          },
        },
      }
    end,
    config = function(_, opts)
      require("gitlinker").setup(opts)
      require("which-key").add({
        { "<leader>g", group = "Git" },
      })
    end,
  },
}
