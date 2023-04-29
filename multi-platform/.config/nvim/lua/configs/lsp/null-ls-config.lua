return function()
    local null_ls = require("null-ls")
    local formatting = null_ls.builtins.formatting
    local diagnostics = null_ls.builtins.diagnostics
    local code_actions = null_ls.builtins.code_actions

    null_ls.setup({
        sources = {
            formatting.eslint_d, -- Faster for formatting on save
            diagnostics.eslint_d,
            code_actions.eslint_d,
            formatting.prettierd.with({
                -- Custom filetypes to enable for svelte
                filetypes = {
                    "javascript",
                    "javascriptreact",
                    "typescript",
                    "typescriptreact",
                    "vue",
                    "css",
                    "scss",
                    "less",
                    "html",
                    "json",
                    "jsonc",
                    "yaml",
                    "markdown",
                    "graphql",
                    "svelte",
                },
            }),
            formatting.stylua,
            formatting.black, -- Python formatter
        },
        on_attach = function(client, bufnr)
            if client.supports_method("textDocument/formatting") then
                local group = vim.api.nvim_create_augroup(
                    "LspFormatting",
                    { clear = true }
                )
                vim.api.nvim_clear_autocmds({
                    group = group,
                    buffer = bufnr,
                })
                vim.api.nvim_create_autocmd("BufWritePre", {
                    group = group,
                    buffer = bufnr,
                    callback = function()
                        vim.lsp.buf.format({
                            bufnr = bufnr,
                        })
                    end,
                })
            end
        end,
    })
end
