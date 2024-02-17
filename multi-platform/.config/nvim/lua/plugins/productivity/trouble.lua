return {
  -- Pretty quickfix menu for LSP/Telescope/etc
  {
    "folke/trouble.nvim",
    dependencies = "nvim-tree/nvim-web-devicons",
    config = function()
      local trouble = require("trouble")

      require("which-key").register({
        ["<leader>,"] = {
          function()
            trouble.previous({
              skip_groups = true,
              jump = true,
            })
          end,
          "Go to previous (Trouble)",
        },
        ["<leader>."] = {
          function()
            trouble.next({ skip_groups = true, jump = true })
          end,
          "Go to next (Trouble)",
        },
        ["<leader>x"] = {
          name = "Trouble",
          x = {
            ":TroubleToggle<CR>",
            "Toggle (Trouble)",
          },
          w = {
            ":Trouble workspace_diagnostics<CR>",
            "Workspace diagnostics (Trouble)",
          },
          d = {
            ":Trouble document_diagnostics<CR>",
            "Document diagnostics (Trouble)",
          },
          q = {
            ":Trouble quickfix<CR>",
            "Quickfix menu (Trouble)",
          },
          l = {
            ":Trouble lsp_references<CR>",
            "LSP references (Trouble)",
          },
        },
      })
    end,
  },
}
