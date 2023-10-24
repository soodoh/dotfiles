return function()
    local ft = require("guard.filetype")

    ft("lua"):fmt("stylua")
    ft("typescript,javascript,typescriptreact,javascriptreact,svelte"):fmt(
        "lsp"
    )
    ft("json,jsonc"):fmt("prettier")
    ft("html,graphql,css,less,scss"):fmt("prettier")
    ft("yaml,markdown,mdx"):fmt("prettier")

    require("guard").setup({
        fmt_on_save = true,
        lsp_as_default_formatter = false,
    })
end
