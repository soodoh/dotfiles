return function()
    local null_ls = require("null-ls")
    local formatting = null_ls.builtins.formatting
    local diagnostics = null_ls.builtins.diagnostics
    local code_actions = null_ls.builtins.code_actions
    local null_ls_opts = require("configs.lsp.default-setup")()
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

    local augroup = vim.api.nvim_create_augroup("LspFormatting", {})
    null_ls_opts.on_attach = function(client, bufnr)
        if client.supports_method("textDocument/formatting") then
            vim.api.nvim_clear_autocmds({
                group = augroup,
                buffer = bufnr,
            })
            vim.api.nvim_create_autocmd("BufWritePre", {
                group = augroup,
                buffer = bufnr,
                callback = function()
                    vim.lsp.buf.format({
                        async = false,
                        filter = function(filter_client)
                            return filter_client.name ~= "tsserver"
                        end,
                    })
                end,
            })
        end
    end

    null_ls.setup(null_ls_opts)
end
