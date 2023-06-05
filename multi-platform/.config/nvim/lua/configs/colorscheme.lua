return function()
    require("material").setup({
        contrast = {},
    })

    -- Set the theme
    vim.o.background = "dark"
    vim.g.material_style = "deep ocean"
    vim.cmd("colorscheme material")
end
