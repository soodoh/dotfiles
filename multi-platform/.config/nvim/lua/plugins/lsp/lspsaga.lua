return {
  -- Better UI for LSP (code actions, diagnostics)
  {
    "nvimdev/lspsaga.nvim",
    dependencies = {
      "nvim-tree/nvim-web-devicons",
      "nvim-treesitter/nvim-treesitter",
    },
    opts = {
      lightbulb = {
        sign = false,
        -- virtual_text = false,
      },
      ui = {
        -- This option only works in Neovim 0.9
        title = true,
        -- Border type can be single, double, rounded, solid, shadow.
        border = "rounded",
        winblend = 0,
        expand = "",
        collapse = "",
        code_action = "💡",
        incoming = " ",
        outgoing = " ",
        hover = " ",
        kind = {},
      },
    },
    config = function(_, opts)
      require("lspsaga").setup(opts)
      require("which-key").register({
        ["<leader>s"] = {
          name = "LSP",
          r = {
            ":Lspsaga rename<CR>",
            "Rename (Lspsaga)",
          },
          h = {
            ":Lspsaga hover_doc<CR>",
            "Hover docs (Lspsaga)",
          },
          a = {
            ":Lspsaga code_action<CR>",
            "Code actions (Lspsaga)",
          },
          d = {
            ":Lspsaga show_line_diagnostics<CR>",
            "Show line diagnostics (Lspsaga)",
          },
        },
        ["[e"] = {
          ":Lspsaga diagnostic_jump_prev<CR>",
          "Go to previous diagnostics (Lspsaga)",
        },
        ["]e"] = {
          ":Lspsaga diagnostic_jump_next<CR>",
          "Go to next diagnostics (Lspsaga)",
        },
      })
    end,
  },
}
