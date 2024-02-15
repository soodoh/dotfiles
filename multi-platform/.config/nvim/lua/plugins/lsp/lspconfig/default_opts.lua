return function(opts)
  local lsp_opts = {}

  -- On attach, used for formatting logic
  lsp_opts.on_attach = function(client, bufnr)
    -- Explicitly enable/disable formatting per LSP provider
    if opts ~= nil and opts.format ~= nil then
      client.server_capabilities.documentFormattingProvider =
          opts.format
    end
    require("lsp-format").on_attach(client, bufnr)
  end

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
