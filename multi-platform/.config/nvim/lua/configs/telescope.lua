return function()
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

  vim.keymap.set("n", "<leader>ff", project_files, { silent = true })
  vim.keymap.set(
    "n",
    "<leader>fg",
    ":lua require('telescope').extensions.live_grep_args.live_grep_args()<CR>",
    { silent = true }
  )
  vim.keymap.set(
    "n",
    "<leader>fb",
    ":Telescope buffers<CR>",
    { silent = true }
  )
  vim.keymap.set(
    "n",
    "<leader>fh",
    ":Telescope oldfiles<CR>",
    { silent = true }
  )

  local actions = require("telescope.actions")
  local trouble = require("trouble.providers.telescope")

  telescope.setup({
    extensions = {
      fzf = {
        fuzzy = true,                           -- false will only do exact matching
        override_generic_sorter = true,         -- override the generic sorter
        override_file_sorter = true,            -- override the file sorter
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
          ["<C-x>"] = trouble.open_with_trouble,
        },
        n = {
          ["<C-c>"] = actions.close,
          ["<C-x>"] = trouble.open_with_trouble,
        },
      },
    },
  })

  -- Load the fzf extension after setup
  telescope.load_extension("fzf")
end
