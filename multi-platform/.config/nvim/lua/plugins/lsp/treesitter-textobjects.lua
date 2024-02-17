return {
  {
    "nvim-treesitter/nvim-treesitter-textobjects",
    after = "nvim-treesitter",
    dependencies = "nvim-treesitter/nvim-treesitter",
    config = function()
      local goto_start = {
        f = "@function.outer",
        b = "@block.outer",
        c = "@call.outer",
        a = "@assignment.outer",
      }

      local goto_end = {
        F = "@function.outer",
        B = "@block.outer",
        C = "@call.outer",
        A = "@assignment.outer",
      }

      local move = {
        enable = true,
        set_jumps = true,
        goto_next_start = {},             -- table to store the mappings for going to the next start
        goto_previous_start = {},         -- table to store the mappings for going to the previous start
        goto_next_end = {},               -- table to store the mappings for going to the next end
        goto_previous_end = {},           -- table to store the mappings for going to the previous end
      }

      -- Loop through the goto_start table and add mappings to goto_next_start table
      for key, value in pairs(goto_start) do
        move.goto_next_start["]" .. key] = value
        move.goto_previous_start["[" .. key] = value         -- add mappings to goto_previous_start table
      end

      -- Loop through the goto_end table and add mappings to respective tables
      for key, value in pairs(goto_end) do
        move.goto_next_end["]" .. key] = value             -- add mappings to goto_next_end table
        move.goto_previous_end["[" .. key] = value         -- add mappings to goto_previous_end table
      end

      require("nvim-treesitter.configs").setup({
        textobjects = {
          lsp_interop = {
            enable = true,
            border = "none",
            floating_preview_opts = {},
            peek_definition_code = {
              ["<leader>sf"] = "@function.outer",
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
          move = move,
        },
      })
    end,
  },
}
