local lsp_installer = require('nvim-lsp-installer')

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
    elseif server.name == 'eslint' then
        opts = vim.tbl_deep_extend('force', opts, require('configs.lsp.eslint'))
    end

    -- This setup() function is exactly the same as lspconfig's setup function.
    -- Refer to https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md
    server:setup(opts)
end)

-- Not included in nvim-lsp-installer
require('lspconfig').flow.setup({})
