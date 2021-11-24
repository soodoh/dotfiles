local buf_map = require("utils").buf_map
local common_on_attach = require("configs.lsp.on_attach")

return {
    on_attach = function(client, bufnr)
        common_on_attach(client, bufnr)
    end,
    -- default command doesn't work on Work computer because Node 12 is in the $PATH
    cmd = {
        "/usr/local/bin/node",
        vim.fn.stdpath("data") .. "/lsp_servers/vscode-eslint/node_modules/.bin/vscode-eslint-language-server",
        "--stdio",
    },
    settings = {
        format = true,
    },
}
