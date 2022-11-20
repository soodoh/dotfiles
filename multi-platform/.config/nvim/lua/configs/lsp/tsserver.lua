local lspconfig = require("lspconfig")

return {
    capabilities = {
        document_formatting = false,
        document_range_formatting = false,
    },
    -- Disable for JS since we use flow
    filetypes = {
        "javascript",
        "javascriptreact",
        "javascript.jsx",
        "typescript",
        "typescriptreact",
        "typescript.tsx",
    },
}
