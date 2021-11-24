return function()
    local keymap = require("utils").keymap
    keymap("n", "<leader>ff", "<cmd>lua require('telescope.builtin').git_files()<CR>")
    keymap("n", "<leader>fg", "<cmd>lua require('telescope.builtin').live_grep()<CR>")
    keymap("n", "<leader>b", "<cmd>lua require('telescope.builtin').buffers()<CR>")

    require("telescope").setup({
        extensions = {
            fzf = {
                fuzzy = true, -- false will only do exact matching
                override_generic_sorter = true, -- override the generic sorter
                override_file_sorter = true, -- override the file sorter
                case_mode = "smart_case", -- or "ignore_case" or "respect_case"
                -- the default case_mode is "smart_case"
            },
        },
        defaults = {
            file_ignore_patterns = { "node_modules", ".git" },
            vimgrep_arguments = {
                "rg",
                "--color=never",
                "--no-heading",
                "--with-filename",
                "--line-number",
                "--column",
                "--smart-case",
                "--hidden",
            },
        },
    })

    -- Load the fzf extension after setup
    require("telescope").load_extension("fzf")
end
