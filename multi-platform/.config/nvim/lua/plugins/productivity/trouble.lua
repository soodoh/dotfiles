return {
  -- Pretty quickfix menu for LSP/Telescope/etc
  {
    "folke/trouble.nvim",
    dependencies = "nvim-tree/nvim-web-devicons",
    opts = {},
    cmd = "Trouble",
    keys = {
      {
        "<leader>xx",
        "<cmd>Trouble diagnostics toggle<CR>",
        desc = "Toggle (Trouble)",
      },
      {
        "<leader>xd",
        "<cmd>Trouble document_diagnostics<CR>",
        desc = "Document diagnostics (Trouble)",
      },
      {
        "<leader>xq",
        "<cmd>Trouble qflist toggle<CR>",
        desc = "Quickfix List (Trouble)",
      },
      {
        "<leader>xl",
        "<cmd>Trouble lsp toggle focus=false win.position=right<CR>",
        desc = "LSP references (Trouble)",
      },
    },
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
