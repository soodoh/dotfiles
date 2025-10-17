return {
  -- Telescope
  {
    "nvim-telescope/telescope.nvim",
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
      local telescope_builtin = require("telescope.builtin")
      -- We cache the results of "git rev-parse"
      -- Process creation is expensive in Windows, so this reduces latency
      local is_inside_work_tree = {}

      local project_files = function()
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

      require("which-key").add({
        { "<leader>f", group = "Telescope" },
        {
          "<leader>ff",
          project_files,
          desc = "Find files",
        },
        {
          "<leader>fg",
          ":lua require('telescope').extensions.live_grep_args.live_grep_args()<CR>",
          desc = "Grep files",
        },
        {
          "<leader>fb",
          ":Telescope buffers<CR>",
          desc = "Find buffer",
        },
        {
          "<leader>fh",
          ":Telescope oldfiles<CR>",
          desc = "Find recent files",
        },
      })

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

      -- Load the fzf extension after setup
      telescope.load_extension("fzf")
    end,
  },
}
