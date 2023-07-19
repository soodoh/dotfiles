local fn = vim.fn

local install_path = fn.stdpath("data")
    .. "/site/pack/packer/start/packer.nvim"
local packer_bootstrap = false
if fn.empty(fn.glob(install_path)) > 0 then
    packer_bootstrap = fn.system({
        "git",
        "clone",
        "--depth",
        "1",
        "https://github.com/wbthomason/packer.nvim",
        install_path,
    })
end
-- Set up package manager
vim.cmd([[packadd packer.nvim]])
local packer = require("packer")

return packer.startup(function(use)
    use("sheerun/vim-polyglot") -- Better syntax highlighing (fallback for treesitter)
    use({
        "kylechui/nvim-surround",
        tag = "*", -- Use for stability; omit to use `main` branch for latest features
        config = function()
            require("nvim-surround").setup()
        end,
    })
    use({
        "phaazon/hop.nvim",
        branch = "v2", -- optional but strongly recommended
        config = function()
            -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
            require("hop").setup()
            vim.keymap.set("n", "s", "<cmd>HopChar2<CR>")
            vim.keymap.set("n", "gl", "<cmd>HopLineStart<CR>")
        end,
    })
    use({
        "numToStr/Comment.nvim",
        config = require("configs.comment"),
    })
    -- Show line indents
    use({
        "lukas-reineke/indent-blankline.nvim",
        config = function()
            vim.g.indent_blankline_filetype_exclude = { "dashboard" }
        end,
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
            vim.keymap.set(
                "n",
                "<leader>w",
                ":Bwipeout<CR>",
                { silent = true }
            )
        end,
    })
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
    use("psliwka/vim-smoothie")        -- Smooth scrolling
    use("nvim-tree/nvim-web-devicons") -- Cool icons
    -- Better buffer tab line
    use({
        "akinsho/bufferline.nvim",
        tag = "*",
        requires = "nvim-tree/nvim-web-devicons",
        config = require("configs.bufferline-config"),
    })
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

    -- Git Integration
    use({
        "lewis6991/gitsigns.nvim",
        requires = { "nvim-lua/plenary.nvim" },
        config = require("configs.gitsigns"),
    })
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

    -- Nvim Tree file explorer
    use({
        "nvim-tree/nvim-tree.lua",
        requires = { "nvim-tree/nvim-web-devicons" },
        config = function()
            require("nvim-tree").setup({
                sort_by = "case_insensitive",
                filters = {
                    dotfiles = false,
                },
                git = {
                    enable = true,
                    ignore = false,
                },
            })
            vim.keymap.set(
                "n",
                "<leader>nn",
                ":NvimTreeToggle<CR>",
                { silent = true }
            )
            vim.keymap.set(
                "n",
                "<leader>nf",
                ":NvimTreeFindFile<CR>",
                { silent = true }
            )
        end,
    })

    -- Color hex codes
    use({
        "norcalli/nvim-colorizer.lua",
        config = require("configs.colorizer"),
    })
    -- Treesitter (LSP-based syntax highlighting)
    use({
        "nvim-treesitter/nvim-treesitter",
        run = ":TSUpdate",
        requires = { "HiPhish/rainbow-delimiters.nvim" },
        config = require("configs.treesitter"),
    })

    -- Intellisense
    use({
        "jackMort/ChatGPT.nvim",
        config = require("configs.chatgpt"),
        requires = {
            "MunifTanjim/nui.nvim",
            "nvim-lua/plenary.nvim",
            "nvim-telescope/telescope.nvim",
        },
    })
    use({
        "williamboman/mason.nvim",
        run = ":MasonUpdate",
        config = function()
            require("mason").setup({
                ui = {
                    border = "rounded",
                },
            })
        end,
    })
    use({
        "williamboman/mason-lspconfig.nvim",
        after = "mason.nvim",
        config = function()
            require("mason-lspconfig").setup({
                automatic_installation = true,
            })
        end,
    })
    use({
        "WhoIsSethDaniel/mason-tool-installer.nvim",
        after = "mason-lspconfig.nvim",
        config = function()
            require("mason-tool-installer").setup({
                ensure_installed = {
                    "black",
                    "stylua",
                    "eslint_d",
                    "prettier",
                    "prettierd",
                },
                auto_update = true,
            })
        end,
    })
    use({
        "neovim/nvim-lspconfig",
        after = "mason-lspconfig.nvim",
        requires = {
            -- Autocomplete stuff
            "hrsh7th/nvim-cmp",
        },
        config = require("configs.lsp"),
    })
    use({
        "kevinhwang91/nvim-ufo",
        requires = "kevinhwang91/promise-async",
        config = require("configs.nvim-ufo"),
    })
    use({
        "luukvbaal/statuscol.nvim",
        config = require("configs.statuscol"),
    })
    use({
        "L3MON4D3/LuaSnip",
        run = "make install_jsregexp",
        config = function()
            vim.keymap.set(
                { "i", "s" },
                "<C-e>",
                "luasnip#choice_active() ? '<Plug>luasnip-next-choice' : '<C-E>'",
                { silent = true }
            )
        end,
    })
    use({
        "hrsh7th/nvim-cmp",
        requires = {
            "hrsh7th/cmp-nvim-lsp",
            "hrsh7th/cmp-buffer",
            "hrsh7th/cmp-path",
            "hrsh7th/cmp-cmdline",
            "hrsh7th/cmp-nvim-lua",
            "hrsh7th/cmp-emoji",
            "chrisgrieser/cmp-nerdfont",
            "onsails/lspkind-nvim", -- Adds icons to autocompletion menu
            -- cmp requires a snippet engine
            "L3MON4D3/LuaSnip",
            "saadparwaiz1/cmp_luasnip",
        },
        config = require("configs.nvim-cmp"),
    })
    use({
        "jose-elias-alvarez/null-ls.nvim",
        requires = { "nvim-lua/plenary.nvim" },
        config = require("configs.lsp.null-ls-config"),
    })
    use({
        "nvimdev/lspsaga.nvim",
        config = require("configs.lspsaga"),
        requires = {
            { "nvim-tree/nvim-web-devicons" },
            { "nvim-treesitter/nvim-treesitter" },
        },
    })

    -- use("mfussenegger/nvim-dap")

    -- Status Line
    use({
        "nvim-lualine/lualine.nvim",
        requires = { "nvim-tree/nvim-web-devicons" },
        config = function()
            require("lualine").setup()
        end,
    })
    use({
        "nvimdev/dashboard-nvim",
        config = require("configs.dashboard"),
        requires = { "nvim-tree/nvim-web-devicons" },
    })
    -- Color schemes
    use({
        -- "folke/tokyonight.nvim",
        "marko-cerovac/material.nvim",
        config = require("configs.colorscheme"),
    })

    use("wbthomason/packer.nvim") -- Packer manages itself!
    -- Automatically set up your configuration after cloning packer.nvim
    -- Put this at the end after all plugins
    if packer_bootstrap then
        require("packer").sync()
    end
end)
