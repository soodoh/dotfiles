return function()
    local common_on_attach = function(_, bufnr)
        local buf_map = require("utils").buf_map
        buf_map(bufnr, "n", "gD", "<cmd>lua vim.lsp.buf.declaration()<CR>")
        buf_map(bufnr, "n", "gd", "<cmd>lua vim.lsp.buf.definition()<CR>")
        buf_map(bufnr, "n", "gi", "<cmd>lua vim.lsp.buf.implementation()<CR>")
    end

    local requested_servers = {
        -- "awk_ls",
        "bashls",
        "cssls",
        "cssmodules_ls",
        -- "denols",
        "dockerls",
        -- "eslint", -- Using null-ls for this
        -- "gopls",
        "graphql",
        "html",
        "intelephense",
        -- "jsonls",
        "pyright",
        -- "rust_analyzer",
        "sumneko_lua",
        "tsserver",
        "yamlls",
    }
    -- go through requested_servers and ensure installation
    local lsp_installer_servers = require("nvim-lsp-installer.servers")
    for _, requested_server in pairs(requested_servers) do
        local ok, server = lsp_installer_servers.get_server(requested_server)
        if ok then
            if not server:is_installed() then
                server:install()
            end
        end
    end

    local lsp_installer = require("nvim-lsp-installer")
    local lspconfig = require("lspconfig")
    -- Setup lspconfig with cmp (auto complete)
    local capabilities = require("cmp_nvim_lsp").update_capabilities(vim.lsp.protocol.make_client_capabilities())

    -- Not included in nvim-lsp-installer
    lspconfig.flow.setup({
        cmd = { "npx", "--no-install", "flow", "lsp" },
        capabilities = capabilities,
        on_attach = common_on_attach,
    })

    -- Register a handler that will be called for all installed servers.
    lsp_installer.on_server_ready(function(server)
        local opts = {
            capabilities = capabilities,
            on_attach = common_on_attach,
        }
        -- Specific server settings
        if server.name == "sumneko_lua" then
            opts = require("configs.lsp.lua")
        elseif server.name == "jsonls" then
            opts = vim.tbl_deep_extend("force", opts, require("configs.lsp.json"))
        elseif server.name == "tsserver" then
            opts = vim.tbl_deep_extend("force", opts, require("configs.lsp.tsserver"))
        end

        -- This setup() function is exactly the same as lspconfig's setup function.
        -- Refer to https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md
        server:setup(opts)
    end)

    -- Format the diagnostic messages
    vim.lsp.handlers["textDocument/publishDiagnostics"] = vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
        underline = true,
        update_in_insert = false,
        virtual_text = false,
    })
end
