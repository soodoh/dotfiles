return function()
    local ft = require("guard.filetype")

    ft("lua"):fmt("stylua")
    ft("typescript,javascript,typescriptreact,javascriptreact")
        :lint("eslint_d")
        :fmt("prettier")

    require("guard").setup({
        fmt_on_save = true,
        lsp_as_default_formatter = true,
    })
end
