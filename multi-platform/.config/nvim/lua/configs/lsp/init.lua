return function()
    -- LSP mappings
    vim.api.nvim_create_autocmd("LspAttach", {
        group = vim.api.nvim_create_augroup("UserLspConfig", {}),
        callback = function(ev)
            local opts = { buffer = ev.buf }
            vim.keymap.set("n", "gD", vim.lsp.buf.declaration, opts)
            vim.keymap.set("n", "gd", vim.lsp.buf.definition, opts)
            vim.keymap.set("n", "gy", vim.lsp.buf.type_definition, opts)
            vim.keymap.set("n", "gi", vim.lsp.buf.implementation, opts)
            vim.keymap.set("n", "gf", function()
                vim.lsp.buf.format({ async = false })
            end, opts)
        end,
    })
    -- Format on save
    local augroup = vim.api.nvim_create_augroup("AutoFormatting", {})
    vim.api.nvim_clear_autocmds({ group = augroup })
    vim.api.nvim_create_autocmd("BufWritePre", {
        group = augroup,
        callback = function()
            vim.lsp.buf.format({ async = false })
        end,
    })

    -- Diagnostic icons
    local signs =
    { Error = "", Warn = "", Hint = "", Info = "" }
    for type, icon in pairs(signs) do
        local hl = "DiagnosticSign" .. type
        vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = hl })
    end

    -- Setup lspconfig with cmp (auto complete)
    local lspconfig = require("lspconfig")
    local get_setup = require("configs.lsp.default-setup")
    -- Unix
    lspconfig.awk_ls.setup(get_setup())
    lspconfig.bashls.setup(get_setup())
    lspconfig.jsonls.setup(require("configs.lsp.json"))
    lspconfig.taplo.setup(get_setup())
    lspconfig.yamlls.setup(get_setup())
    -- Web
    lspconfig.cssls.setup(get_setup())
    lspconfig.cssmodules_ls.setup(get_setup())
    lspconfig.efm.setup(require("configs.lsp.efm"))
    lspconfig.emmet_ls.setup(get_setup())
    lspconfig.graphql.setup(get_setup())
    lspconfig.html.setup(get_setup())
    lspconfig.intelephense.setup(get_setup())
    lspconfig.marksman.setup(get_setup())
    lspconfig.svelte.setup(get_setup())
    lspconfig.tsserver.setup(get_setup({ format = false }))
    -- Server
    lspconfig.clangd.setup(get_setup())
    lspconfig.dockerls.setup(get_setup())
    lspconfig.docker_compose_language_service.setup(get_setup())
    lspconfig.gopls.setup(get_setup())
    lspconfig.lua_ls.setup(get_setup())
    lspconfig.pyright.setup(get_setup())
    lspconfig.rust_analyzer.setup(get_setup())
    lspconfig.terraformls.setup(get_setup())

    -- Format the diagnostic messages
    vim.lsp.handlers["textDocument/publishDiagnostics"] =
        vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
            underline = true,
            update_in_insert = false,
            virtual_text = false,
        })
end
