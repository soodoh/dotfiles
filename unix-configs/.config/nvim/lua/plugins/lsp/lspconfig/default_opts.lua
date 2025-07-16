return function(opts)
  local lsp_opts = {}

  -- On attach, used for formatting logic
  lsp_opts.on_attach = function(client, bufnr)
    -- Explicitly enable/disable formatting per LSP provider
    if opts ~= nil and opts.format ~= nil then
      client.server_capabilities.documentFormattingProvider = opts.format
    end
  end

  -- Optional settings
  if opts ~= nil and opts.settings ~= nil then
    lsp_opts.settings = opts.settings
  end

  lsp_opts.capabilities = require("blink.cmp").get_lsp_capabilities(
    require("lsp-file-operations").default_capabilities()
  )
  -- Needed for nvim-ufo (LSP-based folding)
  -- foldingRange isn't there by default
  lsp_opts.capabilities =
    vim.tbl_deep_extend("force", lsp_opts.capabilities, {
      textDocument = {
        foldingRange = {
          dynamicRegistration = false,
          lineFoldingOnly = true,
        },
      },
    })

  return lsp_opts
end
