return {
  -- LSP File Operations for nvim-tree
  {
    "antosha417/nvim-lsp-file-operations",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-tree.lua",
    },
    config = function()
      require("lsp-file-operations").setup()
    end,
  },

  -- Nvim Tree file explorer
  {
    "nvim-tree/nvim-tree.lua",
    version = "*",
    lazy = false,
    dependencies = {
      "nvim-tree/nvim-web-devicons",
    },
    config = function()
      -- On :bd nvim-tree should behave as if it wasn't opened
      vim.api.nvim_create_autocmd("BufEnter", {
        nested = true,
        callback = function()
          local api = require("nvim-tree.api")
          -- Only 1 window with nvim-tree left: we probably closed a file buffer
          if
              #vim.api.nvim_list_wins() == 1
              and api.tree.is_tree_buf()
          then
            -- Required to let the close event complete. An error is thrown without this.
            vim.defer_fn(function()
              -- close nvim-tree: will go to the last hidden buffer used before closing
              api.tree.toggle({
                find_file = true,
                focus = true,
              })
              -- re-open nivm-tree
              api.tree.toggle({
                find_file = true,
                focus = true,
              })
              -- nvim-tree is still the active window. Go to the previous window.
              vim.cmd("wincmd p")
            end, 0)
          end
        end,
      })

      require("nvim-tree").setup({
        filters = {
          dotfiles = false,
        },
        git = {
          enable = true,
          ignore = false,
        },
      })

      require("which-key").add({
        { "<leader>n", group = "Nvim Tree" },
        {
          "<leader>nn",
          ":NvimTreeToggle<CR>",
          desc = "Toggle (NvimTree)",
        },
        {
          "<leader>nf",
          ":NvimTreeFindFile<CR>",
          desc = "Open to file (NvimTree)",
        },
      })
    end,
  },
}
