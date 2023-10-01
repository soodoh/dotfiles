return {
    -- Nvim Tree file explorer
    {
        "nvim-tree/nvim-tree.lua",
        version = "*",
        lazy = false,
        dependencies = {
            "nvim-tree/nvim-web-devicons",
        },
        config = require("configs.nvim-tree"),
    },

    -- Git status in column
    {
        "lewis6991/gitsigns.nvim",
        dependencies = { "nvim-lua/plenary.nvim" },
        config = require("configs.gitsigns"),
    },

    -- Git diff viewer
    {
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
    },

    -- Pretty quickfix menu for LSP/Telescope/etc
    {
        "folke/trouble.nvim",
        dependencies = "nvim-tree/nvim-web-devicons",
        config = require("configs.trouble"),
    },

    -- Telescope
    {
        "nvim-telescope/telescope-fzf-native.nvim",
        build =
        "cmake -S. -Bbuild -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release && cmake --install build --prefix build",
    },
    {
        "nvim-telescope/telescope.nvim",
        dependencies = {
            "nvim-lua/plenary.nvim",
            "nvim-telescope/telescope-live-grep-raw.nvim",
            "nvim-telescope/telescope-fzf-native.nvim",
            "folke/trouble.nvim",
        },
        config = require("configs.telescope"),
    },

    -- Automatic folds via LSP/Treesitter
    {
        "kevinhwang91/nvim-ufo",
        dependencies = "kevinhwang91/promise-async",
        config = require("configs.nvim-ufo"),
    },

    -- Hotkeys for surrounding brackets/functions/HTML tags
    {
        "kylechui/nvim-surround",
        version = "*",
        event = "VeryLazy",
        config = function()
            require("nvim-surround").setup()
        end,
    },

    -- Hotkeys to move in buffer
    {
        "phaazon/hop.nvim",
        branch = "v2", -- optional but strongly recommended
        config = function()
            -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
            require("hop").setup()
            vim.keymap.set("n", "s", ":HopChar2<CR>")
            vim.keymap.set("n", "gl", ":HopLineStart<CR>")
        end,
    },

    -- Comment hotkeys
    {
        "numToStr/Comment.nvim",
        config = require("configs.comment"),
    },

    -- Keep windows open when closing buffer
    {
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
    },

    -- Automatically enter (){}[] while typing
    {
        "windwp/nvim-autopairs",
        config = function()
            require("nvim-autopairs").setup()
        end,
    },

    -- Floating terminal
    {
        "akinsho/toggleterm.nvim",
        config = require("configs.toggleterm"),
    },

    -- Switch windows or to tmux from nvim
    {
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
    },
}
