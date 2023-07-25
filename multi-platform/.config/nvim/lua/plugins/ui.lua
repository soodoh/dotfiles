return function(use)
    -- Color theme
    use({
        "marko-cerovac/material.nvim",
        config = function()
            require("material").setup({
                contrast = {
                    terminal = true,
                    sidebars = false,
                    floating_windows = false,
                    cursor_line = true,
                    non_current_windows = true,
                },
                plugins = {
                    "dashboard",
                    "gitsigns",
                    "hop",
                    "indent-blankline",
                    "lspsaga",
                    "nvim-cmp",
                    "nvim-tree",
                    "nvim-web-devicons",
                    "telescope",
                    "trouble",
                },
            })
            -- Set the theme
            vim.o.background = "dark"
            vim.g.material_style = "deep ocean"
            vim.cmd("colorscheme material")
        end,
    })

    -- Better syntax highlighing (fallback for treesitter)
    use("sheerun/vim-polyglot")

    -- Welcome dashboard
    use({
        "nvimdev/dashboard-nvim",
        config = require("configs.dashboard"),
        requires = { "nvim-tree/nvim-web-devicons" },
    })

    -- Show line indents
    use({
        "lukas-reineke/indent-blankline.nvim",
        config = function()
            vim.g.indent_blankline_filetype_exclude = { "dashboard" }
        end,
    })

    -- Smooth scrolling
    use({
        "karb94/neoscroll.nvim",
        config = function()
            require("neoscroll").setup({
                hide_cursor = true,
                respect_scrolloff = true,
                cursor_scrolls_alone = true,
                performance_mode = true,
            })
        end,
    })

    -- Better buffer tab line
    use({
        "akinsho/bufferline.nvim",
        tag = "*",
        requires = "nvim-tree/nvim-web-devicons",
        config = require("configs.bufferline-config"),
    })

    -- Status Line
    use({
        "nvim-lualine/lualine.nvim",
        requires = { "nvim-tree/nvim-web-devicons" },
        config = function()
            require("lualine").setup()
        end,
    })

    -- Color hex codes
    use({
        "norcalli/nvim-colorizer.lua",
        config = function()
            require("colorizer").setup({
                "*",
                css = { css = true },
            })
        end,
    })

    -- Custom number/folds/gitsigns column
    use({
        "luukvbaal/statuscol.nvim",
        config = require("configs.statuscol"),
    })
end
