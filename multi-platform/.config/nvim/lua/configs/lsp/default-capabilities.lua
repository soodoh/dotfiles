local capabilities = require("cmp_nvim_lsp").default_capabilities()
-- Needed for nvim-ufo (LSP-based folding)
-- foldingRange isn't there by default
capabilities.textDocument.foldingRange = {
    dynamicRegistration = false,
    lineFoldingOnly = true,
}

return capabilities
