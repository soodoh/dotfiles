return function()
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
end
