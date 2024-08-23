return {
  -- Pretty quickfix menu for LSP/Telescope/etc
  {
    "folke/trouble.nvim",
    dependencies = "nvim-tree/nvim-web-devicons",
    branch = "dev",
    opts = function()
      local trouble = require("trouble")
      require("which-key").add({
        { "<leader>x", group = "Trouble" },
        {
          "<leader>xt",
          function()
            trouble.toggle('telescope')
          end,
          desc = "Telescope results (Trouble)",
        },
        {
          "<leader>xT",
          function()
            trouble.toggle('telescope_files')
          end,
          desc = "Telescope files (Trouble)",
        },
        {
          "<leader>xl",
          function()
            trouble.toggle('lsp')
          end,
          desc = "LSP references (Trouble)",
        },
        {
          "<leader>xq",
          function()
            trouble.toggle('qflist')
          end,
          desc = "Quickfix List (Trouble)",
        },
      })
    end,
  },
  -- config = function()
  --   local trouble = require("trouble")
  --
  --   require("which-key").register({
  --     ["<leader>,"] = {
  --       function()
  --         trouble.previous({
  --           skip_groups = true,
  --           jump = true,
  --         })
  --       end,
  --       "Go to previous (Trouble)",
  --     },
  --     ["<leader>."] = {
  --       function()
  --         trouble.next({ skip_groups = true, jump = true })
  --       end,
  --       "Go to next (Trouble)",
  --     },
  --   })
  -- end,
};
