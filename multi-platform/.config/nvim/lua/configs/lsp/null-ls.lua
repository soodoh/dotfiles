return function()
    local null_ls = require("null-ls")
    local formatting = null_ls.builtins.formatting
    local diagnostics = null_ls.builtins.diagnostics
    local code_actions = null_ls.builtins.code_actions

    local get_setup = require("configs.lsp.default-setup")
    local null_ls_opts = get_setup(true)
    null_ls_opts.sources = {
        formatting.eslint_d,
        diagnostics.eslint_d,
        code_actions.eslint_d,
        formatting.prettier.with({
            extra_filetypes = {
                "svelte",
            },
        }),
        formatting.stylua,
        formatting.black, -- Python formatter
    }

    null_ls.setup(null_ls_opts)
end
