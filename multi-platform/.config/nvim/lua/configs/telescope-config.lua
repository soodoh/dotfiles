return function()
    local keymap = require("utils").keymap
    keymap("n", "<leader>ff", "<cmd>lua require('telescope.builtin').git_files()<CR>")
    keymap("n", "<leader>fg", "<cmd>lua require('telescope').extensions.live_grep_raw.live_grep_raw()<CR>")
    keymap("n", "<leader>fb", "<cmd>lua require('telescope.builtin').buffers()<CR>")
    keymap("n", "<leader>fh", "<cmd>lua require('telescope.builtin').oldfiles()<CR>")

    local actions = require("telescope.actions")
    local trouble = require("trouble.providers.telescope")

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
        pickers = {
            -- git_files = {
            --     theme = "dropdown",
            -- },
            -- live_grep = {
            --     theme = "get_ivy",
            -- },
            -- buffers = {
            --     theme = "dropdown",
            -- },
            -- oldfiles = {
            --     theme = "dropdown",
            -- },
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
            },
            mappings = {
                i = {
                    ["<esc>"] = actions.close,
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
