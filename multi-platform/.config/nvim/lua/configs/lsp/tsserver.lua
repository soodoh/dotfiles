local capabilities = require("cmp_nvim_lsp").default_capabilities()
capabilities.document_formatting = false
capabilities.document_formatting = false

return {
    capabilities = capabilities,
    filetypes = {
        "javascript",
        "javascriptreact",
        "javascript.jsx",
        "typescript",
        "typescriptreact",
        "typescript.tsx",
    },
}
