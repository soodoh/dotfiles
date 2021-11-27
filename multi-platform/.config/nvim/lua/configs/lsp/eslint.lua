return {
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
