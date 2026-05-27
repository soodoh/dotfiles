local is_inside_work_tree = {}

local function project_files()
  local telescope_builtin = require("telescope.builtin")
  local cwd = vim.fn.getcwd()

  if is_inside_work_tree[cwd] == nil then
    vim.fn.system("git rev-parse --is-inside-work-tree")
    is_inside_work_tree[cwd] = vim.v.shell_error == 0
  end

  if is_inside_work_tree[cwd] then
    telescope_builtin.git_files()
  else
    telescope_builtin.find_files()
  end
end

return {
  -- Telescope
  {
    "nvim-telescope/telescope.nvim",
    cmd = "Telescope",
    keys = {
      {
        "<leader>ff",
        project_files,
        desc = "Find files",
      },
      {
        "<leader>fg",
        function()
          require("telescope").extensions.live_grep_args.live_grep_args()
        end,
        desc = "Grep files",
      },
      {
        "<leader>fb",
        "<cmd>Telescope buffers<CR>",
        desc = "Find buffer",
      },
      {
        "<leader>fh",
        "<cmd>Telescope oldfiles<CR>",
        desc = "Find recent files",
      },
      {
        "<leader>fc",
        function()
          require("telescope.builtin").colorscheme({
            enable_preview = true,
            ignore_builtins = true,
          })
        end,
        desc = "Switch/Preview colorscheme",
      },
    },
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-telescope/telescope-live-grep-raw.nvim",
      {
        "nvim-telescope/telescope-fzf-native.nvim",
        build = "make",
      },
      "folke/trouble.nvim",
    },
    config = function()
      local telescope = require("telescope")
      local actions = require("telescope.actions")
      local trouble = require("trouble.sources.telescope")

      telescope.setup({
        extensions = {
          fzf = {
            fuzzy = true, -- false will only do exact matching
            override_generic_sorter = true, -- override the generic sorter
            override_file_sorter = true, -- override the file sorter
          },
        },
        defaults = {
          -- Keep the end of long paths/file names visible in Telescope results.
          path_display = { truncate = 3 },
          vimgrep_arguments = {
            "rg",
            "--color=never",
            "--no-heading",
            "--with-filename",
            "--line-number",
            "--column",
            "--smart-case",
            "--trim",
            "--hidden",
            "--glob=!.git",
          },
          mappings = {
            i = {
              -- ["<esc>"] = actions.close,
              ["<C-c>"] = actions.close,
              ["<C-x>"] = trouble.open,
              ["<C-a>"] = trouble.add,
            },
            n = {
              ["<C-c>"] = actions.close,
              ["<C-x>"] = trouble.open,
              ["<C-a>"] = trouble.add,
            },
          },
        },
      })

      -- Keep Telescope usable even if the native extension has not been built yet.
      local has_fzf = pcall(telescope.load_extension, "fzf")
      if not has_fzf then
        vim.schedule(function()
          vim.notify_once(
            "Telescope FZF native extension is unavailable; run :Lazy build telescope-fzf-native.nvim",
            vim.log.levels.WARN
          )
        end)
      end

      pcall(telescope.load_extension, "live_grep_args")
    end,
  },
}
