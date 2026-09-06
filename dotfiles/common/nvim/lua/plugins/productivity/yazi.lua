return {
  {
    "mikavilpas/yazi.nvim",
    version = "*", -- use the latest stable version
    event = "VeryLazy",
    dependencies = {
      { "nvim-lua/plenary.nvim", lazy = true },
    },
    keys = {
      {
        "<leader>e",
        mode = { "n", "v" },
        ":Yazi<CR>",
        desc = "Open yazi at the current file",
      },
    },
    init = function()
      -- Needed for open_for_directories=true
      -- More details: https://github.com/mikavilpas/yazi.nvim/issues/802
      vim.g.loaded_netrwPlugin = 1
    end,
    config = function()
      require("yazi").setup({
        open_for_directories = true,
        keymaps = {
          show_help = "?",
          -- Let Yazi's shared Ctrl+Y action handle relative paths everywhere.
          copy_relative_path_to_selected_files = false,
        },
      })
    end,
  },
}
