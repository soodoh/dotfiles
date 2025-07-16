return {
  -- Pretty quickfix menu for LSP/Telescope/etc
  {
    "folke/trouble.nvim",
    dependencies = "nvim-tree/nvim-web-devicons",
    opts = function()
      local trouble = require("trouble")
      require("which-key").add({
        { "<leader>x", group = "Trouble" },
        {
          "<leader>xt",
          function()
            trouble.toggle("telescope")
          end,
          desc = "Telescope results (Trouble)",
        },
        {
          "<leader>xT",
          function()
            trouble.toggle("telescope_files")
          end,
          desc = "Telescope files (Trouble)",
        },
        {
          "]x",
          function()
            trouble.next({
              mode = "telescope",
              focus = true,
            })
          end,
          desc = "Go to next Telescope (Trouble)",
        },
        {
          "[x",
          function()
            trouble.prev({
              mode = "telescope",
              focus = true,
            })
          end,
          desc = "Go to prev Telescope (Trouble)",
        },
        {
          "<leader>xl",
          function()
            trouble.toggle("lsp")
          end,
          desc = "LSP references (Trouble)",
        },
        {
          "<leader>xq",
          function()
            trouble.toggle("qflist")
          end,
          desc = "Quickfix List (Trouble)",
        },
      })
    end,
  },
}
