return function(use)
    -- Nvim Tree file explorer
    use({
        "nvim-tree/nvim-tree.lua",
        requires = { "nvim-tree/nvim-web-devicons" },
        config = require("configs.nvim-tree"),
    })

    -- Git status in column
    use({
        "lewis6991/gitsigns.nvim",
        requires = { "nvim-lua/plenary.nvim" },
        config = require("configs.gitsigns"),
    })

    -- Git diff viewer
    use({
        "sindrets/diffview.nvim",
        config = function()
            require("diffview").setup()
            vim.keymap.set(
                "n",
                "<leader>gc",
                ":tabclose<CR>",
                { silent = true }
            )
            -- Current file
            vim.keymap.set("n", "<leader>gd", ":DiffviewOpen HEAD<CR>")
            vim.keymap.set("n", "<leader>gf", ":DiffviewFileHistory %<CR>")
            -- Extras
            vim.keymap.set("n", "<leader>go", ":DiffviewOpen ")
            vim.keymap.set("n", "<leader>gh", ":DiffviewFileHistory<CR>")
        end,
    })

    -- Pretty quickfix menu for LSP/Telescope/etc
    use({
        "folke/trouble.nvim",
        requires = "nvim-tree/nvim-web-devicons",
        config = require("configs.trouble"),
    })

    -- Telescope
    use({ "nvim-telescope/telescope-fzf-native.nvim", run = "make" })
    use({
        "nvim-telescope/telescope.nvim",
        requires = {
            "nvim-lua/plenary.nvim",
            "nvim-telescope/telescope-live-grep-raw.nvim",
            "nvim-telescope/telescope-fzf-native.nvim",
            "folke/trouble.nvim",
        },
        config = require("configs.telescope"),
    })

    -- Automatic folds via LSP/Treesitter
    use({
        "kevinhwang91/nvim-ufo",
        requires = "kevinhwang91/promise-async",
        config = require("configs.nvim-ufo"),
    })

    -- Hotkeys for surrounding brackets/functions/HTML tags
    use({
        "kylechui/nvim-surround",
        tag = "*", -- Use for stability; omit to use `main` branch for latest features
        config = function()
            require("nvim-surround").setup()
        end,
    })

    -- Hotkeys to move in buffer
    use({
        "phaazon/hop.nvim",
        branch = "v2", -- optional but strongly recommended
        config = function()
            -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
            require("hop").setup()
            vim.keymap.set("n", "s", ":HopChar2<CR>")
            vim.keymap.set("n", "gl", ":HopLineStart<CR>")
        end,
    })

    -- Comment hotkeys
    use({
        "numToStr/Comment.nvim",
        config = require("configs.comment"),
    })

    -- Keep windows open when closing buffer
    use({
        "famiu/bufdelete.nvim",
        config = function()
            vim.keymap.set(
                "n",
                "<leader>d",
                ":Bdelete<CR>",
                { silent = true }
            )
            vim.keymap.set("n", "<leader>w", ":bd<CR>", { silent = true })
        end,
    })

    -- Automatically enter (){}[] while typing
    use({
        "windwp/nvim-autopairs",
        config = function()
            require("nvim-autopairs").setup()
        end,
    })

    -- Floating terminal
    use({
        "akinsho/toggleterm.nvim",
        config = require("configs.toggleterm"),
    })

    -- Switch windows or to tmux from nvim
    use({
        "alexghergh/nvim-tmux-navigation",
        config = function()
            require("nvim-tmux-navigation").setup({})

            vim.keymap.set(
                "n",
                "<C-h>",
                ":NvimTmuxNavigateLeft<CR>",
                { silent = true }
            )
            vim.keymap.set(
                "n",
                "<C-j>",
                ":NvimTmuxNavigateDown<CR>",
                { silent = true }
            )
            vim.keymap.set(
                "n",
                "<C-k>",
                ":NvimTmuxNavigateUp<CR>",
                { silent = true }
            )
            vim.keymap.set(
                "n",
                "<C-l>",
                ":NvimTmuxNavigateRight<CR>",
                { silent = true }
            )
        end,
    })
end
