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
        },
        integrations = {
          -- Resolve paths with Neovim itself instead of requiring GNU realpath.
          -- vim.v.progpath tells yazi.nvim's health check which executable owns
          -- the custom implementation below.
          resolve_relative_path_application = vim.v.progpath,
          resolve_relative_path_implementation = function(args)
            local cwd = vim.fn.getcwd()
            local source_dir = vim.uv.fs_realpath(cwd)
              or vim.fs.normalize(cwd)
            local selected_file = vim.uv.fs_realpath(args.selected_file)
              or vim.fs.normalize(args.selected_file)
            local base_dir = source_dir
            local prefix = ""

            while base_dir do
              local relative_path = vim.fs.relpath(base_dir, selected_file)
              if relative_path then
                if relative_path == "." and prefix ~= "" then
                  return prefix:sub(1, -2)
                end

                return prefix .. relative_path
              end

              local parent_dir = vim.fs.dirname(base_dir)
              if not parent_dir or parent_dir == base_dir then
                break
              end

              base_dir = parent_dir
              prefix = prefix .. "../"
            end

            return selected_file
          end,
        },
      })
    end,
  },
}
