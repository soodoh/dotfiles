return {
  {
    "RRethy/nvim-treesitter-textsubjects",
    dependencies = "nvim-treesitter/nvim-treesitter",
    config = function()
      require("nvim-treesitter.configs").setup({
        textsubjects = {
          enable = true,
          prev_selection = ";",
          keymaps = {
            ["."] = {
              "textsubjects-smart",
              desc = "Smart Text Object (LSP)",
            },
          },
        },
      })
    end,
  },
}
