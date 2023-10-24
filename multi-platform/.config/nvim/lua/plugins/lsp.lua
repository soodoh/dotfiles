return {
    -- Treesitter (LSP-based syntax highlighting)
    {
        "nvim-treesitter/nvim-treesitter",
        build = ":TSUpdate",
        dependencies = "HiPhish/rainbow-delimiters.nvim",
        config = require("configs.treesitter"),
    },

    -- Better UI for LSP (code actions, diagnostics)
    {
        "nvimdev/lspsaga.nvim",
        dependencies = {
            "nvim-tree/nvim-web-devicons",
            "nvim-treesitter/nvim-treesitter",
        },
        config = require("configs.lspsaga"),
    },

    -- Autocomplete
    {
        "hrsh7th/nvim-cmp",
        dependencies = {
            "hrsh7th/cmp-nvim-lsp",
            "hrsh7th/cmp-buffer",
            "hrsh7th/cmp-path",
            "hrsh7th/cmp-cmdline",
            "hrsh7th/cmp-nvim-lua",
            "hrsh7th/cmp-emoji",
            "chrisgrieser/cmp-nerdfont",
            -- Adds icons to autocompletion menu
            "onsails/lspkind-nvim",
            -- cmp requires a snippet engine
            "L3MON4D3/LuaSnip",
            "saadparwaiz1/cmp_luasnip",
        },
        config = require("configs.nvim-cmp"),
    },

    -- Snippet Engine (used by nvim-cmp)
    {
        "L3MON4D3/LuaSnip",
        version = "2.*",
        build = "make install_jsregexp",
        config = require("configs.luasnip"),
    },

    -- ChatGPT integration
    {
        "jackMort/ChatGPT.nvim",
        dependencies = {
            "MunifTanjim/nui.nvim",
            "nvim-lua/plenary.nvim",
            "nvim-telescope/telescope.nvim",
        },
        config = require("configs.chatgpt"),
    },

    -- Package manager for LSP/DAP/Linters/Formatters
    {
        "williamboman/mason.nvim",
        build = ":MasonUpdate",
        config = function()
            require("mason").setup({
                ui = {
                    border = "rounded",
                },
            })
        end,
    },

    -- Closes gaps between mason.nvim & lspconfig
    {
        "williamboman/mason-lspconfig.nvim",
        config = function()
            require("mason-lspconfig").setup({
                automatic_installation = true,
            })
        end,
    },
    -- Automatically installs 3rd party tools
    {
        "WhoIsSethDaniel/mason-tool-installer.nvim",
        config = function()
            require("mason-tool-installer").setup({
                ensure_installed = {
                    "black",
                    "stylua",
                    "prettier",
                },
                auto_update = true,
            })
        end,
    },

    -- Configs for nvim LSP client
    {
        "neovim/nvim-lspconfig",
        after = "mason-lspconfig.nvim",
        requires = {
            -- Autocomplete stuff
            "hrsh7th/nvim-cmp",
        },
        config = require("configs.lsp"),
    },
    {
        "nvimdev/guard.nvim",
        dependencies = {
            "nvimdev/guard-collection",
        },
        config = require("configs.lsp.guard"),
    },
}
