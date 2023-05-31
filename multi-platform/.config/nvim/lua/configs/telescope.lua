return function()
    vim.keymap.set(
        "n",
        "<leader>ff",
        ":Telescope git_files<CR>",
        { silent = true }
    )
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

    require("telescope").setup({
        extensions = {
            fzf = {
                fuzzy = true,                   -- false will only do exact matching
                override_generic_sorter = true, -- override the generic sorter
                override_file_sorter = true,    -- override the file sorter
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
    require("telescope").load_extension("fzf")
end
