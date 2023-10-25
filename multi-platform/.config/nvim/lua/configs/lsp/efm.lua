local get_setup = require("configs.lsp.default-setup")
local efm_opts = get_setup()

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
local eslint = {
  formatCommand = "eslint_d --fix-to-stdout --stdin-filename '${INPUT}' --stdin",
  formatStdin = true,
}
local stylua = {
  formatCanRange = true,
  formatCommand = "stylua --color Never ${--range-start:charStart} ${--range-end:charEnd} -",
  formatStdin = true,
  rootMarkers = { "stylua.toml", ".stylua.toml" },
}

local languages = {
  lua = { stylua },
  typescript = { prettier, eslint },
  javascript = { prettier, eslint },
  typescriptreact = { prettier, eslint },
  javascriptreact = { prettier, eslint },
  css = { prettier },
  graphql = { prettier },
  html = { prettier },
  markdown = { prettier },
  json = { prettier },
  python = { prettier },
}

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
