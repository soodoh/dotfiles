return {
  -- Pretty quickfix menu for LSP/Telescope/etc
  {
    "folke/trouble.nvim",
    cmd = "Trouble",
    keys = {
      {
        "<leader>xt",
        function()
          require("trouble").toggle("telescope")
        end,
        desc = "Telescope results (Trouble)",
      },
      {
        "<leader>xT",
        function()
          require("trouble").toggle("telescope_files")
        end,
        desc = "Telescope files (Trouble)",
      },
      {
        "]x",
        function()
          require("trouble").next({
            mode = "telescope",
            focus = true,
          })
        end,
        desc = "Go to next Telescope (Trouble)",
      },
      {
        "[x",
        function()
          require("trouble").prev({
            mode = "telescope",
            focus = true,
          })
        end,
        desc = "Go to prev Telescope (Trouble)",
      },
      {
        "<leader>xl",
        function()
          require("trouble").toggle("lsp")
        end,
        desc = "LSP references (Trouble)",
      },
      {
        "<leader>xq",
        function()
          require("trouble").toggle("qflist")
        end,
        desc = "Quickfix List (Trouble)",
      },
    },
    dependencies = "nvim-tree/nvim-web-devicons",
    opts = {},
  },
}
