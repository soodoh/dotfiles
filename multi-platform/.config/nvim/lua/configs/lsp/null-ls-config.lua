return function()
    local null_ls = require("null-ls")
    local formatting = null_ls.builtins.formatting
    local diagnostics = null_ls.builtins.diagnostics
    local code_actions = null_ls.builtins.code_actions
    local augroup = vim.api.nvim_create_augroup("LspFormatting", {})

    null_ls.setup({
        sources = {
            formatting.eslint_d, -- Faster for formatting on save
            diagnostics.eslint_d,
            code_actions.eslint_d,
            formatting.prettier,
            formatting.stylua,
            formatting.black, -- Python formatter
        },
        on_attach = function(client, bufnr)
            if client.supports_method("textDocument/formatting") then
                vim.api.nvim_clear_autocmds({
                    group = augroup,
                    buffer = bufnr,
                })
                vim.api.nvim_create_autocmd("BufWritePre", {
                    group = augroup,
                    buffer = bufnr,
                    callback = function()
                        vim.lsp.buf.format({ async = false })
                    end,
                })
            end
        end,
    })
end
