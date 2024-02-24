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
              ["<leader>sd"] = "@function.outer",
            },
          },
          swap = {
            enable = true,
            swap_next = {
              ["<leader>ss"] = "@parameter.inner",
            },
            swap_previous = {
              ["<leader>sS"] = "@parameter.inner",
            },
          },
          select = {
            enable = true,
            lookahead = true,
            keymaps = {
              ["af"] = "@function.outer",
              ["if"] = "@function.inner",
              ["ac"] = "@call.outer",
              ["ic"] = "@call.inner",
              ["aa"] = "@assignment.outer",
              ["ia"] = "@assignment.inner",
              -- Map both just to avoid confusion with "sentence" text object
              ["is"] = "@statement.outer",
              ["as"] = "@statement.outer",
            },
          },
          move = {
            enable = true,
            set_jumps = true,
            goto_next_start = {
              [",f"] = "@function.outer",
              [",b"] = "@block.outer",
              [",c"] = "@call.outer",
              [",a"] = "@assignment.outer",
              [",z"] = {
                query = "@fold",
                query_group = "folds",
                desc = "Next fold",
              },
            },
            goto_previous_start = {
              [",,f"] = "@function.outer",
              [",,b"] = "@block.outer",
              [",,c"] = "@call.outer",
              [",,a"] = "@assignment.outer",
            },
            goto_next_end = {
              [",F"] = "@function.outer",
              [",B"] = "@block.outer",
              [",C"] = "@call.outer",
              [",A"] = "@assignment.outer",
            },
            goto_previous_end = {
              [",,F"] = "@function.outer",
              [",,B"] = "@block.outer",
              [",,C"] = "@call.outer",
              [",,A"] = "@assignment.outer",
            },
          },
        },
      })
    end,
  },
}
