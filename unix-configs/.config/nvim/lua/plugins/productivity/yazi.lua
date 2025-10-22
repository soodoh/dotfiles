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
          show_help = "<f1>",
        },
        integrations = {
          resolve_relative_path_implementation = function(
            args,
            get_relative_path
          )
            -- By default, the path is resolved from the file/dir yazi was focused on
            -- when it was opened. Here, we change it to resolve the path from
            -- Neovim's current working directory (cwd) to the target_file.
            local cwd = vim.fn.getcwd()
            local path = get_relative_path({
              selected_file = args.selected_file,
              source_dir = cwd,
            })
            return path
          end,
        },
      })
    end,
  },
}
