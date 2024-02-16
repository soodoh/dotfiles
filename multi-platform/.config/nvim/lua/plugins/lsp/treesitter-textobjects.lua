return {
  {
    "nvim-treesitter/nvim-treesitter-textobjects",
    after = "nvim-treesitter",
    dependencies = "nvim-treesitter/nvim-treesitter",
    config = function()
      require("nvim-treesitter.configs").setup({
        textobjects = {
          lsp_interop = {
            enable = true,
            border = "none",
            floating_preview_opts = {},
            peek_definition_code = {
              ["<leader>df"] = "@function.outer",
              ["<leader>dF"] = "@class.outer",
            },
          },
          select = {
            enable = true,
            keymaps = {
              ["af"] = "@function.outer",
              ["if"] = "@function.inner",
              -- Map both just to avoid confusion with "sentence" text object
              ["is"] = "@scope",
              ["as"] = "@scope",
            },
          },
          move = {
            enable = true,
            set_jumps = true,
            goto_next = {
              ["]m"] = "@function.outer",
              ["]]"] = {
                query = "@class.outer",
                desc = "Next class start",
              },
              ["]s"] = {
                query = "@scope",
                query_group = "locals",
                desc = "Next scope",
              },
              ["]z"] = {
                query = "@fold",
                query_group = "folds",
                desc = "Next fold",
              },
            },
            goto_previous = {
              ["[m"] = "@function.outer",
              ["[["] = {
                query = "@class.outer",
                desc = "Previous class start",
              },
              ["[s"] = {
                query = "@scope",
                query_group = "locals",
                desc = "Previous scope",
              },
              ["[z"] = {
                query = "@fold",
                query_group = "folds",
                desc = "Previous fold",
              },
            },
          },
        },
      })
    end,
  },
}
