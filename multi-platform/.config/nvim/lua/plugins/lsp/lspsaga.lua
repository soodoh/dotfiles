return {
  -- Better UI for LSP (code actions, diagnostics)
  {
    "nvimdev/lspsaga.nvim",
    after = "catppuccin",
    dependencies = {
      "nvim-tree/nvim-web-devicons",
      "nvim-treesitter/nvim-treesitter",
    },
    config = function()
      require("lspsaga").setup({
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
          kind = require(
            "catppuccin.groups.integrations.lsp_saga"
          ).custom_kind(),
        },
      })
      require("which-key").add({
        mode = { "n", "v" },
        { "<leader>s", group = "LSP" },
        {
          "<leader>sr",
          ":Lspsaga rename<CR>",
          desc = "Rename (Lspsaga)",
        },
        {
          "<leader>sh",
          ":Lspsaga hover_doc<CR>",
          desc = "Hover docs (Lspsaga)",
        },
        {
          "<leader>sa",
          ":Lspsaga code_action<CR>",
          desc = "Code actions (Lspsaga)",
        },
        {
          "<leader>sl",
          ":Lspsaga show_line_diagnostics<CR>",
          desc = "Show line diagnostics (Lspsaga)",
        },
        {
          ",,e",
          ":Lspsaga diagnostic_jump_prev<CR>",
          desc = "Go to prev diagnostics (Lspsaga)",
        },
        {
          ",e",
          ":Lspsaga diagnostic_jump_next<CR>",
          desc = "Go to next diagnostics (Lspsaga)",
        },
      })
    end,
  },
}
