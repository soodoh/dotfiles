local prettier = {
  formatCanRange = true,
  formatCommand =
  "prettier --stdin --stdin-filepath '${INPUT}' ${--range-start=charStart} ${--range-end=charEnd} ${--tab-width=tabSize} ${--use-tabs=!insertSpaces}",
  formatStdin = true,
  rootMarkers = {
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yml",
  },
}
-- local stylua = {
--   formatCanRange = false,
--   formatCommand = "stylua --color Never ${--range-start:charStart} ${--range-end:charEnd} -",
--   formatStdin = true,
--   rootMarkers = { "stylua.toml", ".stylua.toml" },
-- }
-- local stylua = require('efmls-configs.formatters.stylua')

local languages = {
  -- lua = { stylua },
  typescript = { prettier },
  javascript = { prettier },
  typescriptreact = { prettier },
  javascriptreact = { prettier },
  css = { prettier },
  graphql = { prettier },
  html = { prettier },
  markdown = { prettier },
  json = { prettier },
  python = { prettier },
}

local efm_opts = require("plugins.lsp.lspconfig.default_opts")()
efm_opts.filetypes = vim.tbl_keys(languages)
efm_opts.init_options = {
  documentFormatting = true,
  documentRangeFormatting = true,
}
efm_opts.settings = {
  rootMarkers = { ".git/" },
  languages = languages,
}

return efm_opts
