local common_on_attach = require('configs.lsp.on_attach')

local requested_servers = {
    'sumneko_lua',
    'tsserver',
    'html',
    'cssls',
    'jsonls',
    'yamlls',
    'bashls',
    'pyright',
    'dockerls',
    'graphql'
}
-- go through requested_servers and ensure installation
local lsp_installer_servers = require('nvim-lsp-installer.servers')
for _, requested_server in pairs(requested_servers) do
  local ok, server = lsp_installer_servers.get_server(requested_server)
  if ok then
    if not server:is_installed() then
      server:install()
    end
  end
end

return function()
    local lsp_installer = require('nvim-lsp-installer')
    local lspconfig = require('lspconfig')

    -- Register a handler that will be called for all installed servers.
    lsp_installer.on_server_ready(function(server)
        -- Setup lspconfig with cmp (auto complete)
        local capabilities = require('cmp_nvim_lsp').update_capabilities(vim.lsp.protocol.make_client_capabilities())
        local opts = {
            capabilities = capabilities,
            on_attach = common_on_attach,
        }

        -- Specific server settings
        if server.name == 'sumneko_lua' then
            opts = vim.tbl_deep_extend('force', opts, require('configs.lsp.lua'))
        elseif server.name == 'jsonls' then
            opts = vim.tbl_deep_extend('force', opts, require('configs.lsp.json'))
        elseif server.name == 'tsserver' then
            opts = vim.tbl_deep_extend('force', opts, require('configs.lsp.tsserver'))
        end

        -- This setup() function is exactly the same as lspconfig's setup function.
        -- Refer to https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md
        server:setup(opts)
    end)

    -- Not included in nvim-lsp-installer
    lspconfig.flow.setup({})
    -- Null-ls for linting/formatting
    require('configs.lsp.null').setup(common_on_attach)
end
