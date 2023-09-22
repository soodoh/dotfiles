return function(use)
    -- Treesitter (LSP-based syntax highlighting)
    use({
        "nvim-treesitter/nvim-treesitter",
        run = ":TSUpdate",
        requires = { "HiPhish/rainbow-delimiters.nvim" },
        config = require("configs.treesitter"),
    })

    -- Better UI for LSP (code actions, diagnostics)
    use({
        "nvimdev/lspsaga.nvim",
        after = "nvim-lspconfig",
        config = require("configs.lspsaga"),
        requires = {
            "nvim-tree/nvim-web-devicons",
            "nvim-treesitter/nvim-treesitter",
        },
    })

    -- Autocomplete
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
            -- Adds icons to autocompletion menu
            "onsails/lspkind-nvim",
            -- cmp requires a snippet engine
            "L3MON4D3/LuaSnip",
            "saadparwaiz1/cmp_luasnip",
        },
        config = require("configs.nvim-cmp"),
    })

    -- Snippet Engine (used by nvim-cmp)
    use({
        "L3MON4D3/LuaSnip",
        run = "make install_jsregexp",
        config = require("configs.luasnip"),
    })

    -- ChatGPT integration
    use({
        "jackMort/ChatGPT.nvim",
        config = require("configs.chatgpt"),
        requires = {
            "MunifTanjim/nui.nvim",
            "nvim-lua/plenary.nvim",
            "nvim-telescope/telescope.nvim",
        },
    })

    -- Package manager for LSP/DAP/Linters/Formatters
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

    -- Closes gaps between mason.nvim & lspconfig
    use({
        "williamboman/mason-lspconfig.nvim",
        after = "mason.nvim",
        config = function()
            require("mason-lspconfig").setup({
                automatic_installation = true,
            })
        end,
    })

    -- Automatically installs 3rd party tools
    use({
        "WhoIsSethDaniel/mason-tool-installer.nvim",
        after = "mason-lspconfig.nvim",
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
    })

    -- Configs for nvim LSP client
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
        "jose-elias-alvarez/null-ls.nvim",
        requires = { "nvim-lua/plenary.nvim" },
        config = require("configs.lsp.null-ls"),
    })
end
