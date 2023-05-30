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
    use("tpope/vim-surround")   -- Surround text objects with {[()]}
    use({
        "phaazon/hop.nvim",
        branch = "v1", -- optional but strongly recommended
        config = require("configs.hop-config"),
    })
    use({
        "numToStr/Comment.nvim",
        config = require("configs.comment-config"),
    })
    -- Show line indents
    use({
        "lukas-reineke/indent-blankline.nvim",
        config = function()
            vim.g.indent_blankline_filetype_exclude = { "dashboard" }
        end,
    })
    use("AndrewRadev/tagalong.vim") -- Auto change HTML tags
    -- Keep windows open when closing buffer
    use({
        "moll/vim-bbye",
        config = function()
            vim.keymap.set(
                "n",
                "<leader>d",
                ":Bdelete<CR>",
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
    -- Floating terminal for LF file explorer
    use({
        "voldikss/vim-floaterm",
        setup = function()
            vim.g.floaterm_opener = "edit"
        end,
        config = function()
            --   -- LF file manager
            vim.keymap.set(
                "n",
                "<leader>e",
                ":FloatermNew lf<CR>",
                { silent = true }
            )
        end,
    })

    -- Git Integration
    use({
        "tpope/vim-fugitive",
        config = function()
            vim.keymap.set(
                "n",
                "<leader>gb",
                ":Git blame<CR>",
                { noremap = true }
            )
            vim.keymap.set(
                "n",
                "<leader>gd",
                ":Gdiff HEAD^<CR>",
                { noremap = true }
            )
        end,
    })
    use("junegunn/gv.vim")
    use("rhysd/git-messenger.vim")
    use({
        "lewis6991/gitsigns.nvim",
        requires = { "nvim-lua/plenary.nvim" },
        config = require("configs.gitsigns-config"),
    })
    use({
        "folke/trouble.nvim",
        requires = "nvim-tree/nvim-web-devicons",
        config = require("configs.trouble-config"),
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
        config = require("configs.telescope-config"),
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
        config = require("configs.colorizer-config"),
    })
    -- Treesitter (LSP-based syntax highlighting)
    use({
        "nvim-treesitter/nvim-treesitter",
        run = ":TSUpdate",
        requires = { "p00f/nvim-ts-rainbow" },
        config = require("configs.treesitter-config"),
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
        "neovim/nvim-lspconfig",
        after = "mason-lspconfig.nvim",
        requires = {
            -- Autocomplete stuff
            "hrsh7th/nvim-cmp",
        },
        config = require("configs.lsp"),
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
        config = require("configs.nvim-cmp-config"),
    })
    use({
        "jose-elias-alvarez/null-ls.nvim",
        requires = { "nvim-lua/plenary.nvim" },
        config = require("configs.lsp.null-ls-config"),
    })
    use({
        "nvimdev/lspsaga.nvim",
        config = require("configs.lspsaga-config"),
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
        config = require("configs.dashboard-config"),
        requires = { "nvim-tree/nvim-web-devicons" },
    })
    -- Color schemes
    use({
        "folke/tokyonight.nvim",
        config = require("configs.colorscheme-config"),
    })

    use("wbthomason/packer.nvim") -- Packer manages itself!
    -- Automatically set up your configuration after cloning packer.nvim
    -- Put this at the end after all plugins
    if packer_bootstrap then
        require("packer").sync()
    end
end)
