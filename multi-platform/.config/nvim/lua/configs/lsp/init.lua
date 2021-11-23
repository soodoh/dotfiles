local buf_map = function(bufnr, mode, lhs, rhs, opts)
    vim.api.nvim_buf_set_keymap(bufnr, mode, lhs, rhs, opts or {
        silent = true,
    })
end

local on_attach = function(client, bufnr)
    vim.cmd("command! LspDef lua vim.lsp.buf.definition()")
    vim.cmd("command! LspFormatting lua vim.lsp.buf.formatting()")
    vim.cmd("command! LspCodeAction lua vim.lsp.buf.code_action()")
    vim.cmd("command! LspHover lua vim.lsp.buf.hover()")
    vim.cmd("command! LspRename lua vim.lsp.buf.rename()")
    vim.cmd("command! LspRefs lua vim.lsp.buf.references()")
    vim.cmd("command! LspTypeDef lua vim.lsp.buf.type_definition()")
    vim.cmd("command! LspImplementation lua vim.lsp.buf.implementation()")
    vim.cmd("command! LspDiagPrev lua vim.lsp.diagnostic.goto_prev()")
    vim.cmd("command! LspDiagNext lua vim.lsp.diagnostic.goto_next()")
    vim.cmd("command! LspDiagLine lua vim.lsp.diagnostic.show_line_diagnostics()")
    vim.cmd("command! LspSignatureHelp lua vim.lsp.buf.signature_help()")
    buf_map(bufnr, "n", "gd", ":LspDef<CR>")
    buf_map(bufnr, "n", "gr", ":LspRename<CR>")
    buf_map(bufnr, "n", "gy", ":LspTypeDef<CR>")
    buf_map(bufnr, "n", "K", ":LspHover<CR>")
    buf_map(bufnr, "n", "[a", ":LspDiagPrev<CR>")
    buf_map(bufnr, "n", "]a", ":LspDiagNext<CR>")
    buf_map(bufnr, "n", "ga", ":LspCodeAction<CR>")
    buf_map(bufnr, "n", "<Leader>a", ":LspDiagLine<CR>")
    buf_map(bufnr, "i", "<C-x><C-x>", "<cmd> LspSignatureHelp<CR>")
    if client.resolved_capabilities.document_formatting then
        vim.cmd("autocmd BufWritePre <buffer> lua vim.lsp.buf.formatting_sync()")
    end
end

return function()
    local lsp_installer = require('nvim-lsp-installer')
    local lspconfig = require('lspconfig')

    -- Register a handler that will be called for all installed servers.
    -- Alternatively, you may also register handlers on specific server instances instead (see example below).
    lsp_installer.on_server_ready(function(server)
        -- Setup lspconfig with cmp (auto complete)
        local capabilities = require('cmp_nvim_lsp').update_capabilities(vim.lsp.protocol.make_client_capabilities())
        local opts = { capabilities = capabilities }

        -- Specific server settings
        if server.name == 'sumneko_lua' then
            opts = vim.tbl_deep_extend('force', opts, require('configs.lsp.lua'))
        elseif server.name == 'jsonls' then
            opts = vim.tbl_deep_extend('force', opts, require('configs.lsp.json'))
        elseif server.name == 'tsserver' then
            opts = {
                on_attach = function(client, bufnr)
                    client.resolved_capabilities.document_formatting = false
                    client.resolved_capabilities.document_range_formatting = false
                    local ts_utils = require("nvim-lsp-ts-utils")
                    ts_utils.setup({
                        eslint_bin = "eslint_d",
                        eslint_enable_diagnostics = true,
                        eslint_enable_code_actions = true,
                        enable_formatting = true,
                        formatter = "npx prettier",
                    })
                    ts_utils.setup_client(client)
                    -- buf_map(bufnr, "n", "gs", ":TSLspOrganize<CR>")
                    -- buf_map(bufnr, "n", "gi", ":TSLspRenameFile<CR>")
                    -- buf_map(bufnr, "n", "go", ":TSLspImportAll<CR>")
                    on_attach(client, bufnr)
                end,
            }
        end

        -- This setup() function is exactly the same as lspconfig's setup function.
        -- Refer to https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md
        server:setup(opts)
    end)

    -- Not included in nvim-lsp-installer
    lspconfig.flow.setup({})
    -- Null-ls for eslint/prettier
    require('null-ls').config({})
    lspconfig['null-ls'].setup({ on_attach = on_attach })
end
