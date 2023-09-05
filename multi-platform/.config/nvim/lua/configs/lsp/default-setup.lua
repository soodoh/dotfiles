return function(should_attach)
    local lsp_opts = {}

    -- The nvim-cmp almost supports LSP's capabilities, so you should advertise it to LSP servers
    lsp_opts.capabilities = require("cmp_nvim_lsp").default_capabilities()

    -- Needed for nvim-ufo (LSP-based folding)
    -- foldingRange isn't there by default
    lsp_opts.capabilities.textDocument.foldingRange = {
        dynamicRegistration = false,
        lineFoldingOnly = true,
    }

    return lsp_opts
end
