return function()
    local common_on_attach = function(_, bufnr)
        local buf_map = require("utils").buf_map
        buf_map(bufnr, "n", "gD", "<cmd>lua vim.lsp.buf.declaration()<CR>")
        buf_map(bufnr, "n", "gd", "<cmd>lua vim.lsp.buf.definition()<CR>")
        buf_map(
            bufnr,
            "n",
            "gi",
            "<cmd>lua vim.lsp.buf.implementation()<CR>"
        )
    end

    -- Setup lspconfig with cmp (auto complete)
    local capabilities = require("cmp_nvim_lsp").default_capabilities()
    local lspconfig = require("lspconfig")
    local default_opts = {
        capabilities = capabilities,
        on_attach = common_on_attach,
    }
    -- Unix
    lspconfig.awk_ls.setup(default_opts)
    lspconfig.bashls.setup(default_opts)
    lspconfig.jsonls.setup(
        vim.tbl_deep_extend(
            "force",
            default_opts,
            require("configs.lsp.json")
        )
    )
    lspconfig.taplo.setup(default_opts)
    lspconfig.yamlls.setup(default_opts)
    -- Web
    lspconfig.cssls.setup(default_opts)
    lspconfig.cssmodules_ls.setup(default_opts)
    lspconfig.graphql.setup(default_opts)
    lspconfig.html.setup(default_opts)
    lspconfig.intelephense.setup(default_opts)
    lspconfig.marksman.setup(default_opts)
    lspconfig.svelte.setup(default_opts)
    lspconfig.tailwindcss.setup(default_opts)
    lspconfig.tsserver.setup(
        vim.tbl_deep_extend(
            "force",
            default_opts,
            require("configs.lsp.tsserver")
        )
    )
    -- Server
    lspconfig.clangd.setup(default_opts)
    -- lspconfig.omnisharp.setup(default_opts)
    lspconfig.dockerls.setup(default_opts)
    lspconfig.docker_compose_language_service.setup(default_opts)
    -- lspconfig.gopls.setup(default_opts)
    lspconfig.lua_ls.setup(require("configs.lsp.lua"))
    lspconfig.pyright.setup(default_opts)
    lspconfig.rust_analyzer.setup(default_opts)
    lspconfig.terraformls.setup(default_opts)

    -- Format the diagnostic messages
    vim.lsp.handlers["textDocument/publishDiagnostics"] =
        vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
            underline = true,
            update_in_insert = false,
            virtual_text = false,
        })
end
